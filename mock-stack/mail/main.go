// mail —— controllable SMTP mock for dev/e2e (§四 错误流 E8/E10/E11 + owner-notify
// 重试 R6). Sits in front of the real Mailpit catcher: a normal message is parsed
// and **forwarded to Mailpit** (so Mailpit still captures it and its HTTP inspection
// API on :8025 keeps working untouched), but the e2e can arm fault conditions over
// HTTP so the next N sends fail at the SMTP level — letting specs drive "send fails →
// booking kept / friendly in-card error / background retry recovers".
//
// Like the llm-gateway mock, behavior is scriptable: POST /__mock/smtp/fail arms a
// failure (count + optional subject substring match, so a condition can key off the
// message content), POST /__mock/smtp/reset clears it. mode is recorded for spec
// readability; the mechanism is "drop the connection" (a retryable transport error).
//
//	SMTP  :1025  — backend's mail connector points its host here (forwards to Mailpit)
//	HTTP  :9400  — POST /__mock/smtp/fail {mode,times,subject_contains}, /reset, /state
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"
)

const (
	defaultPort    = "9400"
	smtpAddr       = ":1025"
	readHeaderTime = 5 * time.Second
)

func main() {
	port := flag.String("port", envOr("PORT", defaultPort), "HTTP control port")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	srv := newServer(log, envOr("MAILPIT_SMTP", "mailpit:1025"))
	if err := srv.startSMTP(smtpAddr); err != nil {
		log.Error("smtp listen", "err", err)
		os.Exit(1)
	}
	if err := srv.run(*port); err != nil {
		log.Error("server exit", "err", err)
		os.Exit(1)
	}
}

func envOr(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}

// server —— in-process fault state + the Mailpit upstream to forward to.
type server struct {
	log      *slog.Logger
	upstream string
	mu       sync.Mutex
	fault    faultState
}

// faultState —— armed failure: remaining count + optional subject substring match.
type faultState struct {
	remaining int
	subject   string
	mode      string
}

func newServer(log *slog.Logger, upstream string) *server {
	return &server{log: log, upstream: upstream}
}

func (s *server) run(port string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /__mock/smtp/fail", s.serveFail)
	mux.HandleFunc("POST /__mock/smtp/reset", s.serveReset)
	mux.HandleFunc("GET /__mock/smtp/state", s.serveState)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	addr := ":" + port
	s.log.Info("mail-mock control listening", "addr", addr, "upstream", s.upstream)
	httpSrv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: readHeaderTime}
	if err := httpSrv.ListenAndServe(); err != nil {
		return fmt.Errorf("http listen: %w", err)
	}
	return nil
}

// failBody —— /__mock/smtp/fail 入参。times 省略 = 持久（直到 reset，模拟「服务宕」）；
// subject_contains 非空 = 只让 subject 含该串的信失败（内容触发，像 llm mock 按 prompt）。
type failBody struct {
	Mode            string `json:"mode"`
	SubjectContains string `json:"subject_contains"`
	Times           int    `json:"times"`
}

func (s *server) serveFail(w http.ResponseWriter, r *http.Request) {
	var req failBody
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	remaining := req.Times
	if remaining == 0 {
		remaining = 1 << 30 // omitted ⇒ persistent until reset
	}
	s.mu.Lock()
	s.fault = faultState{remaining: remaining, subject: req.SubjectContains, mode: req.Mode}
	s.mu.Unlock()
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

func (s *server) serveReset(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	s.fault = faultState{}
	s.mu.Unlock()
	writeJSON(s.log, w, map[string]bool{"ok": true})
}

func (s *server) serveState(w http.ResponseWriter, _ *http.Request) {
	s.mu.Lock()
	f := s.fault
	s.mu.Unlock()
	writeJSON(s.log, w, map[string]int{"remaining": f.remaining})
}

func writeJSON(log *slog.Logger, w http.ResponseWriter, body any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Error("encode", "err", err)
	}
}
