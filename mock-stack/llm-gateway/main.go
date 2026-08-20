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
// On each /v1/messages call the mock scans its registered keywords and, for the
// first one the request text CONTAINS:
//   - a scripted tool → emit tool_use
//   - a scripted reply → emit it as the final text
// else default behavior: corpus_search → corpus_read → text reply (or env
// INFERENCE_MOCK_REPLY).
//
// State is in-process, keyword KV. A test embeds a unique keyword (testId-yyy)
// in its message; only requests containing that keyword match its registration,
// so scripts can never leak across tests. No per-spec reset needed.
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
	log   *slog.Logger
	queue *scriptQueue
	rec   *recorder // 每趟请求记一条,e2e 按 tag 查"这轮走的是哪个 provider"
	reply string    // INFERENCE_MOCK_REPLY fallback
}

func newServer(log *slog.Logger) *server {
	return &server{
		log:   log,
		queue: newScriptQueue(),
		rec:   newRecorder(),
		reply: envOr("INFERENCE_MOCK_REPLY",
			"Hello, this is alice's AI. I'm running in mock mode for tests."),
	}
}

func (s *server) run(port string) error {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/messages", s.serveMessages)
	// GET /v1/models —— 真 provider 都有这条（owner 点「LOAD MODELS」就是问它）。
	// 替身缺了它，「owner 指着自己的自托管端点选模型」这条路在 e2e 里演不出来 ——
	// 而那正是产品卡片上写着支持的用法（ollama / vllm / lm-studio，F-R-9）。
	mux.HandleFunc("GET /v1/models", s.serveModels)
	mux.HandleFunc("POST /__mock/inference/next_tool", s.serveSetNextTool)
	mux.HandleFunc("POST /__mock/inference/next_reply", s.serveSetNextReply)
	mux.HandleFunc("POST /__mock/inference/next_ghost", s.serveSetNextGhost)
	mux.HandleFunc("POST /__mock/inference/next_error", s.serveSetNextError)
	mux.HandleFunc("POST /__mock/inference/next_rate_limit", s.serveSetNextRateLimit)
	mux.HandleFunc("GET /__mock/inference/state", s.serveState)
	mux.HandleFunc("GET /__mock/inference/last_request", s.serveLastRequest)
	mux.HandleFunc("POST /__mock/inference/reset_requests", s.serveResetRequests)
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: readHeaderTime,
	}
	s.log.Info("llm-gateway listen", "port", port)
	return srv.ListenAndServe()
}
