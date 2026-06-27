// launch_test.go —— P.13 / T.8-T.9: the agent core is an independently-launchable
// module. eval-harness (a SEPARATE go module — it can't import backend/internal/*)
// drives it through the public agentcore facade, plugging in its own EvalDriver. These
// two tests pin the invariants the Bridge/Driver design guarantees:
//
//   T.8 faithful  —— a standalone launch composes the REAL prod prompt (not a
//                    hand-stub): the owner persona (Driver.Persona's RoleBody) is
//                    framed by the real usecases.ComposeBasePersona, surfaced verbatim.
//   T.9 parallel  —— N launches run concurrently, each with its OWN injected prompt,
//                    zero cross-talk — the whole point of pulling the agent up
//                    standalone: hunt good prompts across many processes at once.
//
// Independence is structural: these live in eval-harness, import only agentcore, and
// inject behaviour via EvalDriver — zero internal/. Deterministic + offline:
// BuildVisitorAgent only ASSEMBLES (tools + prompt), no LLM call.

package main

import (
	"context"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func evalCred() agentcore.Cred {
	return agentcore.Cred{Provider: "x", Key: "k", Endpoint: "http://unused", Model: "m"}
}

// T.8 —— a standalone launch yields the REAL composed prompt: the owner persona body
// (from the Driver) is framed by the real prod composer (ComposeBasePersona), not a
// stub. If the facade ever degraded to a hand-written prompt, the persona marker would
// not survive the real composition path and this fails.
func TestBuildVisitorAgent_FaithfulComposedPrompt(t *testing.T) {
	const marker = "Marcus-builds-Lucerna"
	driver := &EvalDriver{
		roleBody: "I am Marcus. " + marker + ".",
		corpus: []agentcore.VisitorCorpusEntry{
			{Genre: "wiki", Path: "p1", Title: "Lucerna", Body: "a real project"},
		},
		cred: evalCred(),
	}
	agent, err := agentcore.BuildVisitorAgent(context.Background(), driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "conv-1",
		// SystemPromptOverride empty → faithful composed prompt (not the override path).
	})
	if err != nil {
		t.Fatalf("BuildVisitorAgent: %v", err)
	}
	if !strings.Contains(agent.SystemPrompt, marker) {
		t.Fatalf("composed prompt missing persona marker %q — real ComposeBasePersona did not run; got:\n%s",
			marker, agent.SystemPrompt)
	}
}

// T.9 —— N concurrent standalone launches, each plugging in its own Driver and
// injecting a distinct prompt, each gets ITS prompt back. When SystemPromptOverride is
// set it IS the prompt, so a faithful, isolated launch returns it verbatim; shared or
// leaked launch state would cross-wire the overrides and trip this.
func TestBuildVisitorAgent_ParallelPromptIsolation(t *testing.T) {
	const n = 8
	got := make([]string, n)
	errs := make([]error, n)

	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			override := "VARIANT-PROMPT-" + strconv.Itoa(i)
			driver := &EvalDriver{
				corpus: []agentcore.VisitorCorpusEntry{{Genre: "wiki", Path: "p", Title: "T", Body: "B"}},
				cred:   evalCred(),
			}
			agent, err := agentcore.BuildVisitorAgent(context.Background(), driver, &agentcore.LaunchInput{
				OwnerID: "owner-1", Mode: "public", ConversationID: "conv-" + strconv.Itoa(i),
				SystemPromptOverride: override,
			})
			if err != nil {
				errs[i] = err
				return
			}
			got[i] = agent.SystemPrompt
		}(i)
	}
	wg.Wait()

	for i := 0; i < n; i++ {
		if errs[i] != nil {
			t.Fatalf("concurrent launch %d failed: %v", i, errs[i])
		}
		want := "VARIANT-PROMPT-" + strconv.Itoa(i)
		if got[i] != want {
			t.Fatalf("launch %d: prompt = %q, want %q — concurrent launches cross-wired (not isolated)",
				i, got[i], want)
		}
	}
}
