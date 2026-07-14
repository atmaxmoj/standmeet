// chain_exhaustion_live_test.go —— the EXTREME case for the turn's iteration budget, on the
// REAL model. This is the harness-engineering proof, not a unit test.
//
// Premise: the budget (maxAgentIterations) is a budget — ANY budget can be exhausted by a long
// enough chain. Raising it is necessary, never sufficient. So this eval deliberately builds a
// chain LONGER than the raised budget and asserts the harness still behaves well at the wall.
//
// The chain-vault persona's corpus is a ~33-note Wikipedia-style concept chain
// (photosynthesis → chlorophyll → light → … → evaluation) where each note names the next ONLY
// in its body. That dependency is sequential: the model cannot batch or shortcut it, so
// "follow the chain to the end" forces ~33 hops against a 24-iteration budget → guaranteed
// exhaustion → the forceFinalAnswer boundary fires, for real, on a real model.
//
// Behaving WELL at the wall means (asserted below):
//   - the visitor gets a real, substantial answer — never empty, never an error frame;
//   - it is NOT the model's planning narration ("Let me survey…") — that's process, not product;
//   - it is GROUNDED in what the crawl actually gathered (the boundary must not throw the
//     findings away and answer "I have no specifics" after reading 20+ notes);
//   - it is honest about the part it didn't reach.
//
// Needs a real key (EVAL_KEY / provider key in eval-harness/.env); skips on the mock.

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

// chainAnswerFloor —— a real synthesis of a long crawl is substantial; a planning stub or a
// blanket "I couldn't find anything" is short.
const chainAnswerFloor = 400

func TestChainExhaustionLive_BoundaryStillAnswersGrounded(t *testing.T) {
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("chain-exhaustion eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	p, perr := loadPersona("fixtures/personas/chain-vault")
	if perr != nil {
		t.Fatalf("load persona: %v", perr)
	}
	t.Logf("chain corpus: %d notes", len(p.corpus))

	ctx := context.Background()
	bin := buildHostPlugin(t, "../mcp-servers/retrieval")
	sockDir, derr := os.MkdirTemp("/tmp", "smce")
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
			// Sequential by construction: each note names the next only in its body, so this
			// cannot be batched — it forces ~33 hops through a 24-iteration budget.
			UserMessage: "Start at your photosynthesis note and follow the chain link by link, " +
				"all the way to the end. Read every note in the chain. What is at the very end " +
				"of it, and what are the steps that get you there?",
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
		t.Fatalf("agent errored at the budget wall: %s", sink.errorText())
	}
	t.Logf("chain exhaustion: tools=%d answer_len=%d\nanswer=%s", len(tools), len(answer), answer)

	// The scenario must actually drive a long crawl (else we're not testing the wall).
	if len(tools) < 10 {
		t.Fatalf("chain crawl didn't run deep (tools=%d) — the extreme wasn't exercised.\n"+
			"answer=%s", len(tools), answer)
	}
	// 1. Never empty / never an error frame at the wall.
	if strings.TrimSpace(answer) == "" {
		t.Fatal("budget wall produced an EMPTY answer — the turn's contract is broken")
	}
	// 2. Not raw planning narration (process is not product).
	if looksLikePlanningNarration(answer) {
		t.Fatalf("budget wall handed the visitor planning narration, not an answer.\n"+
			"answer=%s", answer)
	}
	// 3. Substantial — a real synthesis of a deep crawl, not a stub or a blanket punt.
	if len(answer) < chainAnswerFloor {
		t.Fatalf("budget wall produced a stub (%d bytes) after %d tool calls — the boundary "+
			"threw the crawl's findings away instead of synthesising them.\nanswer=%s",
			len(answer), len(tools), answer)
	}
	// 4. GROUNDED in what the crawl gathered: it must name concepts that exist ONLY in the
	//    vault's chain, i.e. it answered from the evidence rather than punting.
	if !mentionsChainConcepts(answer) {
		t.Fatalf("budget wall answer isn't grounded in the crawled chain (names none of its "+
			"concepts) — evidence was discarded at the boundary.\nanswer=%s", answer)
	}
}

// mentionsChainConcepts —— did the answer actually use the chain it crawled? Requires several
// distinct mid-chain concepts, so a generic reply about "photosynthesis" alone can't pass.
func mentionsChainConcepts(answer string) bool {
	low := strings.ToLower(answer)
	concepts := []string{
		"chlorophyll", "electromagnetic", "relativity", "spacetime", "black hole",
		"thermodynamic", "entropy", "information theory", "shannon", "error-correcting",
		"finite field", "group theory", "noether", "lagrangian", "optimal control",
		"dynamic programming", "markov", "reinforcement learning", "neural", "backpropagation",
		"transformer", "scaling", "alignment", "prompting", "evaluation",
	}
	hits := 0
	for _, c := range concepts {
		if strings.Contains(low, c) {
			hits++
		}
	}
	return hits >= 4
}
