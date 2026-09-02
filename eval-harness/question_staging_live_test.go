// question_staging_live_test.go —— A/B/C on "should the visitor's question get a staging pass", real LLM.
//
// The question comes from the owner: does the agent need a staged step — reworking the visitor's
// message into a clear retrieval intent before it searches.
//
// **The material is built to a real scenario — that's where the first version failed.** The first version's
// question was one carefully worded sentence (two clauses, clear phrasing) — all three arms came out identical,
// because it was already staged going in, nothing left to stage.
//
// The real scenario: a hiring manager scans the QR on a resume and, on their phone, types
// "线上炸了咋整" (something like "prod's on fire, what now" in casual Chinese).
//   · The visitor is **lazy**: short, colloquial, abbreviated, mixed Chinese/English, not full sentences, vocabulary that never overlaps the owner's notes;
//   · but this conversation **has a purpose**: the code carries a purpose (hiring manager, backend-focused, cares about production maturity).
// In other words: low information per sentence, high information at the conversation level. If staging has value, that's the gap it lives in.
//
// Three arms, same corpus, same question, same model, differing only by instruction:
//   A baseline —— today's product as-is
//   B staged   —— before searching, reconstruct the message into a clear retrieval intent (no purpose given)
//   C purposed —— same as above, but also tell it this conversation's purpose (simulating the access code's purpose entering the prompt)
//
// C is the real product question under test: `purpose` today is an owner-private note, it never reaches the agent.

package main

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// stagingCorpus —— a backend engineer's vault. The point: **not one note uses the words a visitor would use**.
// The notes say rollback / postmortem / review / orchestration; the visitor says "炸了" ("it's on fire"), "带人" ("mentored anyone"), "k8s".
func stagingCorpus() []agentcore.VisitorCorpusEntry {
	return []agentcore.VisitorCorpusEntry{
		{
			Genre: "wiki", Path: "eng/release/rollback", Title: "Rollback policy",
			Body: "Every deploy ships behind a flag. The rule is one command, under ninety seconds, " +
				"and it never needs a rebuild — a rollback that needs CI is not a rollback.",
		},
		{
			Genre: "wiki", Path: "eng/oncall/postmortem", Title: "Postmortem practice",
			Body: "We write the postmortem before the fix ships, not after, because the fix " +
				"rewrites everyone's memory of what actually happened.",
		},
		{
			Genre: "wiki", Path: "eng/people/review-as-teaching", Title: "Review as teaching",
			Body: "I review for the decision, not the diff. Two years of pairing with juniors " +
				"taught me the review comment that changes someone is the one that asks what they " +
				"considered and rejected — CONSIDERED_REJECTED is the whole method.",
		},
		{
			Genre: "wiki", Path: "eng/infra/orchestration", Title: "Orchestration",
			Body: "Containers are scheduled by a cluster manager; I have run production on one for " +
				"four years and the honest lesson is that most teams adopt it two years before they " +
				"have the load to justify the operational tax. ORCHESTRATION_MARKER.",
		},
		// Distractors: brush up against the visitor's words but can't answer what they're actually asking.
		{
			Genre: "wiki", Path: "eng/release/shipping-cadence", Title: "Shipping cadence",
			Body: "We ship to users several times a day. Small diffs, no release trains, no freeze weeks.",
		},
		{
			Genre: "wiki", Path: "eng/oncall/paging", Title: "Paging policy",
			Body: "A page must be actionable in the moment. If nobody can act at 3am it is a dashboard.",
		},
		{
			Genre: "wiki", Path: "eng/oncall/severity", Title: "Severity levels",
			Body: "Sev1 means users cannot do the main thing. Everything else waits for the morning.",
		},
		{
			Genre: "wiki", Path: "eng/release/feature-flags", Title: "Feature flags",
			Body: "Flags are for exposure control, not branching logic forever. A flag older than two weeks is debt.",
		},
		{
			Genre: "wiki", Path: "eng/testing/pyramid", Title: "Testing",
			Body: "End-to-end only. A unit test on a mock proves the mock works.",
		},
		{
			Genre: "wiki", Path: "eng/data/migrations", Title: "Migrations",
			Body: "Every schema change ships with a migration, tested on a populated volume, never a fresh one.",
		},
		{
			Genre: "wiki", Path: "eng/observability/logs", Title: "Logging",
			Body: "A log line exists so a future incident is explainable without a debugger.",
		},
		{
			Genre: "wiki", Path: "product/pricing", Title: "Pricing",
			Body: "Self-host is free. The hosted tier prices on stored corpus size, not seats.",
		},
	}
}

// lazyTurn —— a lazy question + the markers you only get by answering it correctly.
type lazyTurn struct {
	name    string
	text    string
	markers []string // counts as a hit only if all appear (each lives in only that one note)
}

// What a visitor would actually type: on a phone, abbreviated, not full sentences, mixed Chinese/English.
func lazyTurns() []lazyTurn {
	return []lazyTurn{
		{"炸了", "线上炸了咋整", []string{"ninety", "postmortem"}},
		{"带人", "带过人么", []string{"considered"}},
		{"k8s", "k8s?", []string{"four years"}},
	}
}

const stagedPreamble = "The visitor types the way people type on a phone: short, clipped, " +
	"abbreviated, sometimes not a full sentence, and almost never in the owner's vocabulary. " +
	"Before you search, work out what they are actually asking and what words the owner's " +
	"notes would use for it — those are rarely the visitor's words. Then search for that."

const purposeClause = "\n\nThis conversation's purpose, set by the owner when they issued " +
	"this visitor's access code: a hiring manager at a payments company screening the owner " +
	"for a senior backend role; they care about production maturity, incident handling, and " +
	"whether the owner has grown other engineers."

func TestQuestionStaging_LiveLazyVisitorABC(t *testing.T) {
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("staging A/B/C needs a real LLM (set EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	arms := []struct{ name, preamble string }{
		{"A baseline", ""},
		{"B staged", stagedPreamble},
		{"C purposed", stagedPreamble + purposeClause},
	}
	const runs = 2

	for _, arm := range arms {
		hits, total, tools := 0, 0, 0
		for _, turn := range lazyTurns() {
			for i := 0; i < runs; i++ {
				r := runOneTurn(t, cred, arm.preamble, turn)
				total++
				tools += r.toolCalls
				if r.hit {
					hits++
				}
				t.Logf("  %-11s %-5s run%d: hit=%-5v searches=%d tools=%d",
					arm.name, turn.name, i+1, r.hit, r.searches, r.toolCalls)
			}
		}
		t.Logf("%-11s → 召回 %d/%d，平均工具调用 %.1f", arm.name, hits, total, float64(tools)/float64(total))
	}
}

type turnResult struct {
	hit       bool
	searches  int
	toolCalls int
	answer    string
}

func runOneTurn(t *testing.T, cred agentcore.Cred, preamble string, turn lazyTurn) turnResult {
	t.Helper()
	driver := &EvalDriver{cred: cred, corpus: stagingCorpus()}
	agent := mustLaunch(t, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	system := agent.SystemPrompt
	if preamble != "" {
		system += "\n\n" + preamble
	}
	sink := newCaptureSink()
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: system, Model: cred.Model, UserMessage: turn.text,
		},
		Mode: "public", Tools: agent.Tools,
		ProgressLabels: agent.Labels, ReturnDirectly: agent.ReturnDirectly,
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if rerr := agentcore.RunAgentLoop(context.Background(), log, in, sink); rerr != nil {
		t.Fatalf("RunAgentLoop: %v", rerr)
	}
	answer, tools, ok := sink.result()
	if !ok {
		t.Fatalf("agent errored: %s", sink.errorText())
	}
	searches := 0
	for i := range tools {
		if tools[i].Name == "corpus_search" {
			searches++
		}
	}
	low := strings.ToLower(answer)
	hit := true
	for _, m := range turn.markers {
		if !strings.Contains(low, m) {
			hit = false
		}
	}
	return turnResult{hit: hit, searches: searches, toolCalls: len(tools), answer: answer}
}
