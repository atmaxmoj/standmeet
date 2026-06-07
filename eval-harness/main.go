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
//     smoke.sh against the deterministic llm-gateway.
//   - batch:    --scenarios <file|dir> [--grep <substr>] loads YAML scenarios,
//     scripts the gateway per-scenario, runs each, prints a summary.
//
// Against the dev/e2e llm-gateway (Anthropic-compatible, scripted replies) it
// produces verifiable output without a real API key; point --endpoint/--key
// at a real provider (e.g. DeepSeek) to audit live behaviour.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func main() {
	loadDotenv() // self-configure from .env before resolving cred
	dc := resolveCredDefaults()
	provider := flag.String("provider", dc.Provider, "LLM provider")
	key := flag.String("key", dc.Key, "API key")
	endpoint := flag.String("endpoint", dc.Endpoint, "provider base URL")
	model := flag.String("model", dc.Model, "model id")
	system := flag.String("system", "You are a helpful assistant.", "system instruction")
	user := flag.String("user", "Say hello.", "user message")
	mode := flag.String("mode", "public", "visitor mode (public/code/byoai)")
	withTools := flag.Bool("tools", true, "ad-hoc: register the canned corpus_search/corpus_read toolset")
	corpusDir := flag.String("corpus", "", "ad-hoc: load a persona corpus dir and register real corpus_search/corpus_read (overrides --tools)")
	scenarios := flag.String("scenarios", "", "batch: path to a scenario .yml or a dir of them")
	grep := flag.String("grep", "", "batch: keep only scenarios whose name contains this substring")
	asJSON := flag.Bool("json", false, "batch: emit JSONL (one event per line) instead of human transcript")
	interviewMode := flag.Bool("interview", false, "interview: simulate a full multi-turn interview (needs --corpus)")
	role := flag.String("role", "senior backend engineer", "interview: the position being interviewed for")
	exchanges := flag.Int("exchanges", 12, "interview: rough number of Q/A exchanges (~30–60 min)")
	flag.Parse()

	// Loop diagnostics go to stderr (warn+); the transcript owns stdout so it
	// stays clean for assertion.
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	cred := agentcore.Cred{Provider: *provider, Key: *key, Endpoint: *endpoint, Model: *model}
	// Transparency: show which LLM this run hits (never the key) so real-vs-mock
	// is obvious. localhost:9300 = deterministic mock gateway.
	fmt.Fprintf(os.Stderr, "eval: provider=%s endpoint=%s model=%s\n", cred.Provider, cred.Endpoint, cred.Model)

	switch {
	case *interviewMode:
		os.Exit(runInterview(log, cred, *corpusDir, *role, *exchanges))
	case *scenarios != "":
		os.Exit(runBatch(log, *scenarios, *grep, cred, pickFormatter(*asJSON)))
	default:
		runAdHoc(log, cred, adHocOpts{
			system: *system, user: *user, mode: *mode,
			withTools: *withTools, corpusDir: *corpusDir,
		})
	}
}

// runInterview loads the persona corpus and drives a full simulated interview.
func runInterview(log *slog.Logger, cred agentcore.Cred, corpusDir, role string, exchanges int) int {
	if corpusDir == "" {
		log.Error("--interview requires --corpus <persona dir>")
		return 2
	}
	c, err := loadCorpus(corpusDir)
	if err != nil {
		log.Error("load corpus", "err", err)
		return 1
	}
	iv := &interview{cred: cred, corpus: c, role: role, maxExchange: exchanges, out: os.Stdout, log: log}
	if rerr := iv.run(context.Background()); rerr != nil {
		log.Error("interview", "err", rerr)
		return 1
	}
	return 0
}

type adHocOpts struct {
	system, user, mode, corpusDir string
	withTools                     bool
}

// runBatch loads + filters scenarios, runs them through the formatter, emits
// the summary, and returns a process exit code (0 = all clean).
func runBatch(log *slog.Logger, path, grep string, cred agentcore.Cred, fmtr formatter) int {
	scs, err := loadScenarios(path, grep)
	if err != nil {
		log.Error("load scenarios", "err", err)
		return 1
	}
	if len(scs) == 0 {
		log.Error("no scenarios matched", "path", path, "grep", grep)
		return 1
	}
	results := runScenarios(context.Background(), log, os.Stdout, scs, cred, fmtr)
	if fmtr.summary(os.Stdout, results) {
		return 0
	}
	return 1
}

func runAdHoc(log *slog.Logger, cred agentcore.Cred, opts adHocOpts) {
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req:  &agentcore.AgentTurnRequest{System: opts.system, UserMessage: opts.user, Model: cred.Model},
		Mode: opts.mode,
	}
	switch {
	case opts.corpusDir != "":
		c, err := loadCorpus(opts.corpusDir)
		if err != nil {
			log.Error("load corpus", "err", err)
			os.Exit(1)
		}
		in.Tools, in.ProgressLabels = corpusToolset(c)
	case opts.withTools:
		in.Tools, in.ProgressLabels = cannedToolset()
	}
	sink := newTranscriptSink(os.Stdout)
	if err := agentcore.RunAgentLoop(context.Background(), log, in, sink); err != nil {
		sink.fatal(err)
		os.Exit(1)
	}
}
