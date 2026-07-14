// narration_live_test.go —— F-A-4 eval (REAL model, retrieval wired). NOT the mock.
//
// The real-env audit found: a broad visitor question returned the AI's own planning
// narration ("Let me survey… Let me check my notes…") with no grounded answer. This eval
// reproduces it against the REAL model (DeepSeek v4-pro), the way an eval is meant to run:
// inject a persona prompt + corpus, wire the REAL corpus tools (the retrieval plugin over a
// host socket, same as crawl_retrieval_live_test), and drive the SAME prod loop via the
// agentcore facade. Fresh fictional persona (Dana Rivera) — never the owner's key data.
//
// Unlike --ask (which does NOT wire the retrieval plugin, so the model has no corpus tools),
// this gives the model real corpus_search/read/links. It asserts the model actually GROUNDS a
// broad question (calls the tools) and returns a synthesized answer — not planning narration,
// not an ungrounded riff. Needs a real key (EVAL_KEY / provider key); skips on the mock.

package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func TestNarrationLive_BroadQuestionGetsGroundedSynthesis(t *testing.T) {
	loadDotenv() // self-configure from eval-harness/.env, like the --ask binary does
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("F-A-4 live eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	p, perr := loadPersona("fixtures/personas/dana-rivera")
	if perr != nil {
		t.Fatalf("load persona: %v", perr)
	}

	ctx := context.Background()
	bin := buildHostPlugin(t, "../mcp-servers/retrieval")
	sockDir, derr := os.MkdirTemp("/tmp", "smnl")
	if derr != nil {
		t.Fatalf("sock dir: %v", derr)
	}
	defer func() { _ = os.RemoveAll(sockDir) }()
	sock := filepath.Join(sockDir, "r.sock")

	driver := &EvalDriver{
		cred: cred, roleBody: p.roleBody, corpus: p.corpus,
		plugins: []agentcore.PluginSpec{{
			ID: "corpus.retrieval", Command: bin,
			Env:         map[string]string{"RETRIEVAL_SOCKET": sock},
			HostSockets: []string{sock}, RawToolNames: true, ACLAlways: true,
		}},
	}
	stop, serr := agentcore.StartRetrievalSocket(ctx, driver, sock)
	if serr != nil {
		t.Fatalf("StartRetrievalSocket: %v", serr)
	}
	defer func() { _ = stop() }()

	agent, err := agentcore.BuildVisitorAgent(ctx, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	if err != nil {
		t.Fatalf("BuildVisitorAgent: %v", err)
	}

	sink := newCaptureSink()
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, Model: cred.Model,
			UserMessage: broadQuestion(),
		},
		Mode: "public", Tools: agent.Tools,
		ProgressLabels: agent.Labels, ReturnDirectly: agent.ReturnDirectly,
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if rerr := agentcore.RunAgentLoop(ctx, log, in, sink); rerr != nil {
		t.Fatalf("RunAgentLoop: %v", rerr)
	}
	answer, tools, ok := sink.result()
	if !ok {
		t.Fatalf("agent errored: %s", sink.errorText())
	}
	t.Logf("F-A-4 live: tools=%d\nanswer=%s", len(tools), answer)

	// F-A-4: on a broad question the model must actually GROUND the answer (call the corpus
	// tools) and synthesize — not narrate its planning and stop, not riff ungrounded.
	if len(tools) == 0 {
		t.Fatalf("F-A-4 reproduced: model made ZERO corpus tool calls on a broad question — "+
			"the answer is ungrounded / planning narration, not grounded synthesis.\nanswer=%s",
			answer)
	}
	// The answer must not be dominated by planning narration ("let me search / check my notes").
	if looksLikePlanningNarration(answer) {
		t.Fatalf("F-A-4 reproduced: answer is planning narration, not a synthesized answer.\n"+
			"answer=%s", answer)
	}
}

// broadQuestion —— the broad synthesis question (overridable via EVAL_QUESTION to probe how
// wide a question the real model can take before it exhausts its tool budget without answering).
func broadQuestion() string {
	if q := os.Getenv("EVAL_QUESTION"); q != "" {
		return q
	}
	return "What's your overall philosophy as a designer, and how does it actually show up " +
		"across your projects? Walk me through the throughline."
}

// looksLikePlanningNarration —— a rough heuristic: the answer is short AND opens with a
// "let me search / check my notes / pull up" planning preamble and never delivers substance.
func looksLikePlanningNarration(answer string) bool {
	low := strings.ToLower(strings.TrimSpace(answer))
	if low == "" {
		return true
	}
	preambles := []string{"let me ", "i'll pull", "i'll check", "i'll search", "let me pull",
		"let me check", "let me search", "*[checks", "```json"}
	opensWithPlan := false
	for _, p := range preambles {
		if strings.HasPrefix(low, p) {
			opensWithPlan = true
			break
		}
	}
	// A real synthesized answer is substantial; a pure planning stub is short.
	return opensWithPlan && len(low) < 240
}
