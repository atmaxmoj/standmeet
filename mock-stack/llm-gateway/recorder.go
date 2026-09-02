// recorder.go —— records "who this request came from and who it went to",
// so e2e can assert on **which upstream**.
//
// Origin: once an owner started holding multiple provider credentials (#6),
// "which provider did this round go through" became something worth
// asserting on — but this mock originally knew nothing about the caller: it
// didn't look at Authorization, didn't record the path,
// /__mock/inference/state just spat out the registered scripts.
// byoai-chat.spec passed because there was only one candidate at the time
// (point the visitor's endpoint here, and getting a reply back proved it
// went through); that trick stopped working once there were three providers.
//
// **Query by tag, never hand out "the last one".** A global last-request is
// shared state under parallel workers: another spec's request overwrites
// yours, and it goes red as if your feature broke. So this stores a ring
// instead, and queries find the most recent entry by **the tag embedded in
// the request text** — the tag is the unique string mock-llm-script.ts
// already plants in the message, which the caller already has, no need to
// register it separately.
//
// **Credentials keep only a prefix.** Asserting "which key was used" needs
// to be able to distinguish keys, not see the key itself; recording the
// full value would be writing a secret into the e2e log. An 8-character
// prefix is enough to tell two fake test keys apart without being a leak.
package main

import (
	"net/http"
	"strings"
	"sync"
)

// recordRing —— keeps this many recent entries. Enough for several specs
// running in parallel to each find their own; more than that has no point
// (queries always look for the most recent match by tag).
const recordRing = 64

// authPrefixLen —— credentials keep only this much of a prefix (enough to distinguish, not enough to reconstruct).
const authPrefixLen = 8

// RequestRecord —— the assertable facts about one /v1/messages request.
type RequestRecord struct {
	Path       string `json:"path"`        // which path it hit (different providers can configure different base paths)
	Model      string `json:"model"`       // the model in the request — the most direct signal of "which config took effect"
	AuthPrefix string `json:"auth_prefix"` // the credential's first 8 characters
	Stream     bool   `json:"stream"`
	Found      bool   `json:"found"` // false when nothing was found, so the caller can tell "nothing was recorded" apart from "recorded, but the field is empty"
	// Contains —— when `?contains=` is given: whether it appears anywhere in
	// **the full message text** of that request.
	//
	// Why this earns its own field: some criteria ask "did this actually
	// make it into the model's context" — e.g. the visitor cancelled a
	// meeting from a card, and the agent should know about it next round
	// (F-B-9). That event isn't visible on screen, isn't visible in the
	// database — the only place it shows up is **the message that was sent
	// to the model**. This recorder was already keeping the full text
	// (markerText); it just wasn't exposed to be queried.
	Contains bool `json:"contains"`
}

// recorder —— the request ring. Mostly writes, few reads; one lock is enough.
type recorder struct {
	mu   sync.Mutex
	ring []RequestRecord
	text []string // parallel to ring: that entry's marker text (queries match against it)
}

func newRecorder() *recorder {
	return &recorder{
		ring: make([]RequestRecord, 0, recordRing),
		text: make([]string, 0, recordRing),
	}
}

// record —— records one entry. Drops the oldest once full.
func (rec *recorder) record(r RequestRecord, markerText string) {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.ring) == recordRing {
		rec.ring = rec.ring[1:]
		rec.text = rec.text[1:]
	}
	rec.ring = append(rec.ring, r)
	rec.text = append(rec.text, markerText)
}

// findByTag —— the **most recent** entry whose text contains tag. Empty tag
// → matches nothing (an empty string would Contains-match everything, which
// is exactly the "global last" trap; explicitly blocked here).
// Empty needle → Contains is always false (an empty string would
// Contains-match everything too — the same trap as the tag case).
func (rec *recorder) findByTag(tag, needle string) RequestRecord {
	if tag == "" {
		return RequestRecord{}
	}
	rec.mu.Lock()
	defer rec.mu.Unlock()
	for i := len(rec.ring) - 1; i >= 0; i-- {
		if strings.Contains(rec.text[i], tag) {
			hit := rec.ring[i]
			hit.Found = true
			hit.Contains = needle != "" && strings.Contains(rec.text[i], needle)
			return hit
		}
	}
	return RequestRecord{}
}

// findByText —— finds the most recent request **by content, not by tag**.
//
// Why it's needed: some requests simply aren't "the call for a given round"
// — **compaction** is a model call in its own right, carrying the messages
// that got compacted plus the summarization task. Searching by tag returns
// that round's **own** call (it comes later in time), so `contains=` ends
// up judging the wrong request — I went red on exactly this in F-D-10, and
// the red was in the query, not the product. Use this one whenever the
// criterion is "did **any** request in this round carry this text".
func (rec *recorder) findByText(needle string) RequestRecord {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	for i := len(rec.ring) - 1; i >= 0; i-- {
		if needle != "" && strings.Contains(rec.text[i], needle) {
			hit := rec.ring[i]
			hit.Found = true
			hit.Contains = true
			return hit
		}
	}
	return RequestRecord{}
}

// recordFrom —— folds an HTTP request + its parsed body into one record.
// Checks both credential headers: Anthropic uses x-api-key, OpenAI-compat uses Authorization: Bearer.
func recordFrom(r *http.Request, req *MessagesReq) RequestRecord {
	return RequestRecord{
		Path:       r.URL.Path,
		Model:      req.Model,
		AuthPrefix: authPrefix(r),
		Stream:     req.Stream,
	}
}

func authPrefix(r *http.Request) string {
	raw := r.Header.Get("x-api-key")
	if raw == "" {
		raw = strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	}
	if len(raw) > authPrefixLen {
		return raw[:authPrefixLen]
	}
	return raw
}

// clear —— empties the record ring.
//
// Why it has to exist: a script's tag is `<testId>-<n>`, and **the same
// spec gets the same tag every time it runs** — while this ring stays alive
// across runs. So "the record left behind by the last run (when the code
// was good)" gets hit by this run's query, and from then on the criterion
// can never judge negative: I ran into exactly this on this bug once —
// "rip out the part that was fixed, and the test still stays green."
func (rec *recorder) clear() {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	rec.ring = rec.ring[:0]
	rec.text = rec.text[:0]
}

// serveResetRequests —— POST /__mock/inference/reset_requests
func (s *server) serveResetRequests(w http.ResponseWriter, _ *http.Request) {
	s.rec.clear()
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

// serveLastRequest —— GET /__mock/inference/last_request?tag=xxx[&contains=yyy]
func (s *server) serveLastRequest(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	writeJSON(s.log, w, s.rec.findByTag(q.Get("tag"), q.Get("contains")))
}

// serveAnyRequest —— GET /__mock/inference/any_request?contains=yyy
// "Did **any** request in this round carry this text." The compaction call
// doesn't belong to any tag, so this is the only way to ask.
func (s *server) serveAnyRequest(w http.ResponseWriter, r *http.Request) {
	writeJSON(s.log, w, s.rec.findByText(r.URL.Query().Get("contains")))
}
