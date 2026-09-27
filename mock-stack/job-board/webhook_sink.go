// webhook_sink.go — the webhook receiver the e2e suite points endpoints at
// (docs/design/event-bus-outbox-webhooks.md, *Phases*: "webhook-sink").
//
//   POST /webhook-sink/{name}                        — a delivery. Recorded with its headers and body,
//                                                      then answered per the sink's plan (200 by default).
//   POST /__mock/webhook-sink/{name}/plan            — {"status":500,"count":2,"retry_after":"30"}:
//                                                      answer the next `count` deliveries with `status`
//                                                      (count 0 = every one from now on).
//   GET  /__mock/webhook-sink/{name}/received        — every delivery recorded so far, oldest first.
//   POST /__mock/webhook-sink/reset                  — forget everything.
//
// It behaves like a real receiver in the one way that matters: it answers with the status it was
// told to, so retry, snooze and discard are exercised against real HTTP, never assumed.

package main

import (
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"sync"
	"time"
)

type sinkDelivery struct {
	Headers map[string]string `json:"headers"`
	Body    json.RawMessage   `json:"body"`
	Raw     string            `json:"raw"` // the bytes as received: what a signature is computed over
	At      time.Time         `json:"at"`
	Status  int               `json:"status"`
}

type sinkPlan struct {
	RetryAfter string `json:"retry_after"`
	Status     int    `json:"status"`
	Count      int    `json:"count"`
}

type webhookSink struct {
	received map[string][]sinkDelivery
	plans    map[string]*sinkPlan
	mu       sync.Mutex
}

var sink = &webhookSink{received: map[string][]sinkDelivery{}, plans: map[string]*sinkPlan{}} //nolint:gochecknoglobals // mock state

const sinkBodyLimit = 1 << 20

func webhookSinkRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /webhook-sink/{name}", sink.deliver)
	mux.HandleFunc("POST /__mock/webhook-sink/{name}/plan", sink.setPlan)
	mux.HandleFunc("GET /__mock/webhook-sink/{name}/received", sink.list)
	mux.HandleFunc("POST /__mock/webhook-sink/reset", sink.reset)
}

// answer — the status this delivery gets, consuming one use of the plan.
func (s *webhookSink) answer(name string) (int, string) {
	p, ok := s.plans[name]
	if !ok {
		return http.StatusOK, ""
	}
	if p.Count > 0 {
		p.Count--
		if p.Count == 0 {
			delete(s.plans, name)
		}
	}
	return p.Status, p.RetryAfter
}

func (s *webhookSink) deliver(w http.ResponseWriter, r *http.Request) {
	body, _ := io.ReadAll(io.LimitReader(r.Body, sinkBodyLimit))
	headers := map[string]string{}
	for k := range r.Header {
		headers[http.CanonicalHeaderKey(k)] = r.Header.Get(k)
	}
	name := r.PathValue("name")
	s.mu.Lock()
	status, retryAfter := s.answer(name)
	raw := string(body)
	if !json.Valid(body) {
		body, _ = json.Marshal(raw)
	}
	s.received[name] = append(s.received[name], sinkDelivery{
		Headers: headers, Body: body, Raw: raw, At: time.Now().UTC(), Status: status,
	})
	s.mu.Unlock()
	if retryAfter != "" {
		w.Header().Set("Retry-After", retryAfter)
	}
	w.WriteHeader(status)
}

func (s *webhookSink) setPlan(w http.ResponseWriter, r *http.Request) {
	var p sinkPlan
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil || p.Status < 100 {
		http.Error(w, "plan needs a status", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.plans[r.PathValue("name")] = &p
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (s *webhookSink) list(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	out := append([]sinkDelivery{}, s.received[r.PathValue("name")]...)
	s.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Count", strconv.Itoa(len(out)))
	_ = json.NewEncoder(w).Encode(out)
}

func (s *webhookSink) reset(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	s.received = map[string][]sinkDelivery{}
	s.plans = map[string]*sinkPlan{}
	s.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}
