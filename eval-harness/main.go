// eval-harness —— an independent driver that runs the backend's agentic
// loop out-of-process, decoupled from HTTP/SSE, to audit prompt / agent
// behaviour / state-churn.
//
// It lives in its own Go module (its own go.mod, replace → ../backend) and
// imports only the public facade github.com/atmaxmoj/standmeet/agentcore. It
// builds a Cred + AgentTurnInput, injects a transcript AgentSink, and runs
// the exact same eino ADK loop the HTTP path (RunAgentTurn) runs — so the
// transcript reflects真实 prod behaviour, not a re-implementation.
//
// Two modes:
//   - ad-hoc:   flags (--system/--user/--tools …) drive one turn. Used by
//               smoke.sh against the deterministic llm-gateway.
//   - batch:    --scenarios <file|dir> [--grep <substr>] loads YAML scenarios,
//               scripts the gateway per-scenario, runs each, prints a summary.
//
// Against the dev/e2e llm-gateway (Anthropic-compatible, scripted replies) it
// produces verifiable output without a real API key; point --endpoint/--key
// at a real provider (e.g. DeepSeek) to audit live behaviour.
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
	withTools := flag.Bool("tools", true, "ad-hoc: register the canned corpus_search/corpus_read toolset")
	scenarios := flag.String("scenarios", "", "batch: path to a scenario .yml or a dir of them")
	grep := flag.String("grep", "", "batch: keep only scenarios whose name contains this substring")
	flag.Parse()

	// Loop diagnostics go to stderr (warn+); the transcript owns stdout so it
	// stays clean for assertion.
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	cred := agentcore.Cred{Provider: *provider, Key: *key, Endpoint: *endpoint, Model: *model}

	if *scenarios != "" {
		os.Exit(runBatch(log, *scenarios, *grep, cred))
	}
	runAdHoc(log, cred, *system, *user, *mode, *withTools)
}

// runBatch loads + filters scenarios, runs them, prints the summary, and
// returns a process exit code (0 = all clean).
func runBatch(log *slog.Logger, path, grep string, cred agentcore.Cred) int {
	scs, err := loadScenarios(path, grep)
	if err != nil {
		log.Error("load scenarios", "err", err)
		return 1
	}
	if len(scs) == 0 {
		log.Error("no scenarios matched", "path", path, "grep", grep)
		return 1
	}
	results := runScenarios(context.Background(), log, os.Stdout, scs, cred)
	if printSummary(os.Stdout, results) {
		return 0
	}
	return 1
}

func runAdHoc(log *slog.Logger, cred agentcore.Cred, system, user, mode string, withTools bool) {
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req:  &agentcore.AgentTurnRequest{System: system, UserMessage: user, Model: cred.Model},
		Mode: mode,
	}
	if withTools {
		in.Tools, in.ProgressLabels = cannedToolset()
	}
	sink := newTranscriptSink(os.Stdout)
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
