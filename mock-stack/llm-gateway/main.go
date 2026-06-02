// llm-gateway —— Anthropic-compatible LLM endpoint for dev/e2e.
//
// Replaces backend's in-process MockProvider. Backend's resolver always
// builds AnthropicProvider; in dev/e2e the owner's `endpoint` column
// points at this gateway so /v1/messages traffic lands here. Internal
// behavior:
//
//   POST /v1/messages   — Anthropic Messages API (SSE streaming)
//   POST /__mock/inference/next_tool   — e2e queues a tool_use to emit
//   POST /__mock/inference/next_reply  — e2e queues final reply text
//
// On each /v1/messages call:
//   - if a tool is queued, pop + emit tool_use
//   - else default behavior: corpus_search → corpus_read → text reply
//   - else emit text reply (scripted queue or env INFERENCE_MOCK_REPLY)
//
// State is in-process and cleared per-process. e2e runs single-process
// so parallel tests scoping each visitor session is fine.
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"time"
)

const (
	defaultPort    = "9300"
	readHeaderTime = 5 * time.Second
)

func main() {
	port := flag.String("port", envOr("PORT", defaultPort), "listen port")
	flag.Parse()
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	srv := newServer(log)
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

type server struct {
	log    *slog.Logger
	queue  *scriptQueue
	reply  string // INFERENCE_MOCK_REPLY fallback
}

func newServer(log *slog.Logger) *server {
	return &server{
		log:   log,
		queue: newScriptQueue(),
		reply: envOr("INFERENCE_MOCK_REPLY",
			"Hello, this is alice's AI. I'm running in mock mode for tests."),
	}
}

func (s *server) run(port string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/messages", s.serveMessages)
	mux.HandleFunc("POST /__mock/inference/next_tool", s.serveSetNextTool)
	mux.HandleFunc("POST /__mock/inference/next_reply", s.serveSetNextReply)
	mux.HandleFunc("GET /__mock/inference/state", s.serveState)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: readHeaderTime,
	}
	s.log.Info("llm-gateway listen", "port", port)
	return srv.ListenAndServe()
}
