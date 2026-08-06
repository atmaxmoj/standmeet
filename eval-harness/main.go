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

// printMarker —— 把内核那句日志原样打出来给 shell 断言用。名字不认识 → 报错退出,
// 而不是打个空串让 grep 匹配一切。
func printMarker(name string) int {
	if name != "compaction" {
		fmt.Fprintf(os.Stderr, "unknown marker %q (have: compaction)\n", name)
		return 2
	}
	fmt.Println(agentcore.CompactionLogMsg)
	return 0
}

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
	ask := flag.Bool("ask", false, "ask: one candidate turn — read askRequest JSON on stdin, write askResponse JSON on stdout (needs --persona)")
	persona := flag.String("persona", "", "ask: persona dir (system.md + corpus/) the candidate answers as")
	// marker —— print a log marker the kernel emits, so a shell assertion greps for the ONE
	// string the kernel actually logs. The compaction assertion grepped a hard-coded copy and
	// went silently unsatisfiable when that line was renamed.
	marker := flag.String("marker", "", "print a kernel log marker by name (compaction) and exit")
	flag.Parse()

	if *marker != "" {
		os.Exit(printMarker(*marker))
	}

	// Loop diagnostics go to stderr (warn+); the transcript owns stdout so it
	// stays clean for assertion.
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
	cred := agentcore.Cred{Provider: *provider, Key: *key, Endpoint: *endpoint, Model: *model}
	// Transparency: show which LLM this run hits (never the key) so real-vs-mock
	// is obvious. localhost:9300 = deterministic mock gateway.
	fmt.Fprintf(os.Stderr, "eval: provider=%s endpoint=%s model=%s\n", cred.Provider, cred.Endpoint, cred.Model)

	switch {
	case *ask:
		os.Exit(runAsk(log, cred, *persona))
	case *scenarios != "":
		os.Exit(runBatch(log, *scenarios, *grep, cred, pickFormatter(*asJSON)))
	default:
		runAdHoc(log, cred, adHocOpts{
			system: *system, user: *user, mode: *mode,
			withTools: *withTools, corpusDir: *corpusDir,
		})
	}
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
		attachRealCorpusTools(context.Background(), log, in, &cred, opts)
	case opts.withTools:
		in.Tools, in.ProgressLabels = cannedToolset()
	}
	sink := newTranscriptSink(os.Stdout)
	if err := agentcore.RunAgentLoop(context.Background(), log, in, sink); err != nil {
		sink.fatal(err)
		os.Exit(1)
	}
}

// attachRealCorpusTools loads a persona corpus dir and assembles the REAL
// visitor agent over it (via the facade), attaching its corpus tools to the
// ad-hoc turn. --system still wins as the prompt (injected as the override), so
// the ad-hoc probe keeps its hand-set system while exercising real retrieval.
func attachRealCorpusTools(
	ctx context.Context, log *slog.Logger, in *agentcore.AgentTurnInput,
	cred *agentcore.Cred, opts adHocOpts,
) {
	c, err := loadCorpus(opts.corpusDir)
	if err != nil {
		log.Error("load corpus", "err", err)
		os.Exit(1)
	}
	agent, berr := agentcore.BuildVisitorAgent(ctx, &EvalDriver{
		corpus: toVisitorCorpus(c),
		cred:   *cred,
	}, &agentcore.LaunchInput{
		OwnerID: evalOwnerID, Mode: opts.mode, ConversationID: evalConvID,
		SystemPromptOverride: opts.system,
	})
	if berr != nil {
		log.Error("build visitor agent", "err", berr)
		os.Exit(1)
	}
	in.Req.System = agent.SystemPrompt
	in.Tools, in.ProgressLabels, in.ReturnDirectly = agent.Tools, agent.Labels, agent.ReturnDirectly
}
