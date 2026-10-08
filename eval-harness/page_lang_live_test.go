// page_lang_live_test.go —— does the answer come back in the language the visitor is reading
// (owner 2026-10-04: the page language "要注入给agent的"). The page tells the agent its language
// (AgentTurnRequest.PageLang → one line in the instruction). The rule under test:
//   - the page's language is the fallback: a message in no language ("👋", "MCP?") is answered in
//     the page's language (a one-word English message is English, and is not tested as neutral);
//   - a visitor who writes a full question in another language is answered in theirs.
//
// Judged by script, not by eye: the share of Han characters among all letters in the answer.
// The corpus is English, so a Chinese answer can only come from the instruction, not from copying.
//
//	EVAL_ROUNDS=3 make eval-page-lang

package main

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"unicode"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// hanShare —— Han characters / (Han + Latin letters). 0 for an answer with no letters.
func hanShare(s string) float64 {
	han, latin := 0, 0
	for _, r := range s {
		switch {
		case unicode.Is(unicode.Han, r):
			han++
		case unicode.In(r, unicode.Latin) && unicode.IsLetter(r):
			latin++
		}
	}
	if han+latin == 0 {
		return 0
	}
	return float64(han) / float64(han+latin)
}

// TestHanShareSeesTheLanguage —— the criterion self-verifies on fixed text.
func TestHanShareSeesTheLanguage(t *testing.T) {
	if s := hanShare("闸门从不拒绝，就不是闸门，只是一句注释。gate"); s < 0.7 {
		t.Fatalf("a Chinese answer with one English word scored %.2f", s)
	}
	if s := hanShare("A gate that never rejects is not a gate; it is a comment (闸门)."); s > 0.2 {
		t.Fatalf("an English answer with one Chinese word scored %.2f", s)
	}
}

type pageLangCase struct {
	name, pageLang, message string
	wantChinese             bool
}

var pageLangCases = []pageLangCase{
	{"zh page, a message in no language", "zh", "👋", true},
	{"zh page, a full English question", "zh",
		"What does a regulator need in order to hold a system steady?", false},
	{"en page, a full Chinese question", "en", "这些笔记里说的闸门是什么意思？", true},
	{"en page, a message in no language", "en", "👋", false},
	{"zh page, a name on its own", "zh", "MCP?", true},
	// No page language at all (an older client, or a page that declares none): unchanged, the
	// answer follows the visitor.
	{"no page language, a full Chinese question", "", "这些笔记里说的闸门是什么意思？", true},
	{"no page language, a full English question", "",
		"What does a regulator need in order to hold a system steady?", false},
}

func TestPageLangLive(t *testing.T) {
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("page-language live eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	cred := cd.cred()
	rounds := evalRounds()
	wrong := 0
	for i := range rounds {
		for _, c := range pageLangCases {
			share := askInPageLang(t, &cred, c)
			chinese := share >= 0.5
			t.Logf("round %d · %s: han share %.2f", i, c.name, share)
			if chinese != c.wantChinese {
				wrong++
				t.Errorf("round %d · %s: answered in the wrong language (han share %.2f)", i, c.name, share)
			}
		}
	}
	t.Logf("page language live: %d wrong of %d", wrong, rounds*len(pageLangCases))
}

func askInPageLang(t *testing.T, cred *agentcore.Cred, c pageLangCase) float64 {
	t.Helper()
	ctx := context.Background()
	driver := &EvalDriver{cred: *cred, corpus: corpusWithoutTheOwner()}
	agent := mustLaunch(t, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	sink := newCaptureSink()
	in := &agentcore.AgentTurnInput{
		Cred: cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, Model: cred.Model, UserMessage: c.message, PageLang: c.pageLang,
		},
		Mode: "public", Tools: agent.Tools,
		ProgressLabels: agent.Labels, ReturnDirectly: agent.ReturnDirectly,
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := agentcore.RunAgentLoop(ctx, log, in, sink); err != nil {
		t.Fatalf("RunAgentLoop: %v", err)
	}
	answer, _, ok := sink.result()
	if !ok {
		t.Fatalf("agent errored: %s", sink.errorText())
	}
	t.Logf("%s → %s", c.message, answer)
	return hanShare(answer)
}
