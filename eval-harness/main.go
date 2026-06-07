// eval-harness —— a minimal independent driver proving the backend's
// agentic loop can be invoked out-of-process, decoupled from HTTP/SSE.
//
// It lives in its own Go module (its own go.mod, replace → ../backend) and
// imports only the public facade github.com/atmaxmoj/standmeet/agentcore.
// It builds a Cred + AgentTurnInput, injects a transcript AgentSink, and
// runs the exact same eino ADK loop the HTTP path (RunAgentTurn) runs — the
// proof that the agentic core is genuinely callable from a separate stack.
//
// Against the dev/e2e llm-gateway (Anthropic-compatible, deterministic
// scripted replies) it produces verifiable output without a real API key.
// Scenario loading / canned tools / JSONL transcript are later slices.
package main

import (
	"context"
	"flag"
	"log/slog"
	"os"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func main() {
	provider := flag.String("provider", env("EVAL_PROVIDER", "anthropic"), "LLM provider")
	key := flag.String("key", env("EVAL_KEY", "dev-llm-gateway-dummy-key"), "API key")
	endpoint := flag.String("endpoint", env("EVAL_ENDPOINT", "http://localhost:9300"), "provider base URL")
	model := flag.String("model", env("EVAL_MODEL", "claude-sonnet-4-6"), "model id")
	system := flag.String("system", "You are a helpful assistant.", "system instruction")
	user := flag.String("user", "Say hello.", "user message")
	mode := flag.String("mode", "public", "visitor mode (public/code/byoai)")
	withTools := flag.Bool("tools", true, "register the canned corpus_search/corpus_read toolset")
	flag.Parse()

	// Loop diagnostics go to stderr (warn+); the transcript owns stdout so
	// it stays clean for assertion.
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	sink := newTranscriptSink(os.Stdout)

	in := &agentcore.AgentTurnInput{
		Cred: &agentcore.Cred{
			Provider: *provider, Key: *key, Endpoint: *endpoint, Model: *model,
		},
		Req:  &agentcore.AgentTurnRequest{System: *system, UserMessage: *user},
		Mode: *mode,
	}
	if *withTools {
		in.Tools, in.ProgressLabels = cannedToolset()
	}

	if err := agentcore.RunAgentLoop(context.Background(), log, in, sink); err != nil {
		sink.fatal(err)
		os.Exit(1)
	}
}

func env(name, def string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return def
}
