// narration_maxiter_test.go —— F-A-4 eval (deterministic, mock gateway, NO real LLM key).
//
// The real-env audit found: a visitor asks a BROAD question, and the AI replies with its
// own planning narration ("Let me survey… Let me dig into…") concatenated — no actual answer.
//
// Root cause (backend/internal/inference/agent_loop.go handleTerminalError): when the model
// narrates its planning as visible text each tool round and keeps searching, the loop runs
// out its MaxIterations budget. Because *some* assistant text streamed, the loop treats that
// planning narration as "a partial answer" and keeps it — skipping the forceFinalAnswer that
// would produce a real synthesis. The visitor is left with the narration.
//
// This pins it deterministically. The mock llm-gateway is scripted (via the [[narrate]]
// marker) to behave exactly like the failing model: stream a planning line + a corpus_search
// every round, never synthesize. A fresh fictional persona (Dana Rivera — no personal data)
// gives the broad question something to be "about". The turn runs through the SAME prod loop
// (agentcore facade) the HTTP path runs.
//
// GREEN = the visitor gets a synthesized final answer (the forced no-tool reply carries the
// mock's persona-system echo). RED = the answer is raw planning narration (no synthesis) —
// F-A-4 reproduced. Needs `make gateway-up` (the deterministic mock gateway); skips if down.

package main

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// mockGatewayCred —— force the deterministic mock gateway, never the operator's real key.
// (F-A-4 is a loop bug, not a model-quality bug, so a scripted model reproduces it exactly.)
func mockGatewayCred() agentcore.Cred {
	return agentcore.Cred{
		Provider: "anthropic", Key: "dev-llm-gateway-dummy-key",
		Endpoint: "http://localhost:9300", Model: "claude-sonnet-4-6",
	}
}

// danaRoleBody —— fresh fictional persona (no personal data), same shape as the real
// owner-voice prompt: a first-person identity + "ground your answers in your corpus".
func danaRoleBody() string {
	return "You are Dana Rivera, an independent product designer (~8 years, fintech + " +
		"healthcare). Answer visitor questions in Dana's own first-person voice — natural " +
		"and opinionated. Everything true about you lives in your corpus; ground your " +
		"answers in it."
}

// danaCorpus —— a few opinion/experience notes so a broad "what's your take" question is
// genuinely answerable from the corpus.
func danaCorpus() []agentcore.VisitorCorpusEntry {
	return []agentcore.VisitorCorpusEntry{
		{
			Genre: "wiki", Path: "profile/overview", Title: "About Dana",
			Body: "Dana Rivera — independent product designer, ~8 years across fintech and " +
				"healthcare. Opinionated about design systems, accessibility, and cutting steps.",
		},
		{
			Genre: "wiki", Path: "thinking/design-philosophy", Title: "Design philosophy",
			Body: "Good design is invisible: it removes friction rather than adding polish. I " +
				"favor boring, accessible, well-worn patterns over novelty for its own sake.",
		},
		{
			Genre: "wiki", Path: "thinking/accessibility", Title: "On accessibility",
			Body: "Accessibility is the baseline, not a checkbox. I design for screen readers " +
				"and keyboard first; if it doesn't work there it isn't done.",
		},
		{
			Genre: "wiki", Path: "work/ledger-app", Title: "Ledger app redesign",
			Body: "Rebuilt a budgeting app's onboarding; cut drop-off ~40% by removing steps " +
				"and defaulting the common path.",
		},
	}
}

func TestNarrationMaxIter_VisitorGetsSynthesisNotPlanningNarration(t *testing.T) {
	if !gatewayReachable(mockGatewayCred().Endpoint) {
		t.Skip("mock llm-gateway not up (run: make gateway-up); skipping F-A-4 eval")
	}
	cred := mockGatewayCred()
	ctx := context.Background()

	bin := buildHostPlugin(t, "../mcp-servers/retrieval")
	sockDir, derr := os.MkdirTemp("/tmp", "smn")
	if derr != nil {
		t.Fatalf("sock dir: %v", derr)
	}
	defer func() { _ = os.RemoveAll(sockDir) }()
	sock := filepath.Join(sockDir, "r.sock")

	driver := &EvalDriver{
		cred: cred, roleBody: danaRoleBody(), corpus: danaCorpus(),
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
			// A broad stance question — the shape that triggered F-A-4 on real prod. The
			// [[narrate]] marker makes the mock behave like the failing model deterministically.
			UserMessage: "What's your overall take on what makes good design? [[narrate]]",
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

	// The scenario must actually exercise the narrate loop (multiple tool rounds) so we're
	// really testing the MaxIterations path, not an early stop.
	if len(tools) < 3 {
		t.Fatalf("narrate loop didn't run (tools=%d) — scenario not exercised.\nanswer=%q",
			len(tools), answer)
	}
	// Confirm the planning narration was actually produced (else the scenario is wrong).
	if !strings.Contains(answer, "Let me") {
		t.Fatalf("expected planning narration in the stream; scenario not exercised.\nanswer=%q", answer)
	}
	// F-A-4: on MaxIterations the visitor must still get a synthesized final answer, not raw
	// planning narration. The forced no-tool reply is the only text carrying the mock's persona
	// system echo ("[system:"); streamed narration never does.
	if !answerIsSynthesized(answer) {
		t.Fatalf("F-A-4 reproduced: on MaxIterations the visitor got planning narration, "+
			"not a synthesized answer.\nanswer=%q", answer)
	}
}

// answerIsSynthesized —— did a real final synthesis close the turn? The mock's forced-final
// (no-tool) reply is composed with a "[system:…]" persona echo; the streamed planning
// narration is not. So the echo's presence marks that forceFinalAnswer actually ran.
func answerIsSynthesized(answer string) bool {
	return strings.Contains(answer, "[system:") || strings.Contains(answer, "mock mode")
}

func gatewayReachable(endpoint string) bool {
	c := &http.Client{Timeout: 800 * time.Millisecond}
	resp, err := c.Post(endpoint+"/__mock/inference/next_reply", "application/json",
		strings.NewReader(`{"text":""}`))
	if err != nil {
		return false
	}
	_ = resp.Body.Close()
	return true
}
