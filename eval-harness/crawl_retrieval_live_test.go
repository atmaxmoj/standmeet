// crawl_retrieval_live_test.go —— link/crawl retrieval eval, BEHAVIORAL (real LLM).
//
// The deterministic test (crawl_retrieval_test.go) proves the crawl MECHANISM works. This one proves the
// AGENT actually uses it: given a corpus where the answer-bearing fact lives in note B, reachable only by
// following note A's [[link]] (or the corpus_links edge), does the real model crawl there and answer with
// B's fact — rather than stopping at A's summary or inventing?
//
// Needs a real LLM. Set EVAL_KEY (or OPENAI_API_KEY / ANTHROPIC_API_KEY / DEEPSEEK_API_KEY). With none,
// resolveCredDefaults falls back to the local mock gateway (scripted, not a real model) — the test SKIPS.
//
//	go test -run TestCrawlRetrieval_LiveAgentCrawls -v   (with EVAL_KEY set)

package main

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func TestCrawlRetrieval_LiveAgentCrawls(t *testing.T) {
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("live crawl eval needs a real LLM (set EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	ctx := context.Background()
	driver := &EvalDriver{cred: cred, corpus: linkedCorpus()}
	agent := mustLaunch(t, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})

	sink := newCaptureSink()
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, Model: cred.Model,
			// The deep result lives in note B (good-regulator-theorem), which note A (theory) only
			// LINKS to — answering "what exactly does it claim" requires crawling to B.
			UserMessage: "What's the deepest theoretical result about regulation in your notes, " +
				"and what exactly does it claim?",
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

	// (a) the agent CRAWLED to B — read good-regulator-theorem or walked the link edge.
	if !reachedNoteB(tools) {
		t.Fatalf("agent did not crawl to the linked note (no corpus_links / no read of good-regulator-theorem).\ntools=%v\nanswer=%s", tools, answer)
	}
	// (b) the answer carries B's fact — "a good regulator must be a MODEL of the system" — which is
	// only reachable by the crawl. (A alone never states it.)
	if !strings.Contains(strings.ToLower(answer), "model") {
		t.Fatalf("answer is missing the good-regulator fact (regulator must be a MODEL of the system) — crawl produced no multi-hop content.\nanswer=%s", answer)
	}
}

// reachedNoteB —— did the agent walk to note B, via the links edge or a direct read of it?
func reachedNoteB(tools []toolUse) bool {
	for i := range tools {
		if tools[i].Name == "corpus_links" {
			return true
		}
		if tools[i].Name == "corpus_read" && strings.Contains(tools[i].Args, "good-regulator-theorem") {
			return true
		}
	}
	return false
}
