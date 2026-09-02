// owner_identity_live_test.go —— UX-66's guard: **once the corpus is narrowed,
// does this AI still know who it is**.
//
// What it looks like on prod: a codeless visitor asks "can I book 30 minutes
// with sijie", and the answer opens with
// "I don't have anyone named Sijie in my notes, and I've got no calendar…".
// Refusing to book is correct (the public identity never had booking to begin
// with); **denying knowing the owner is not**.
//
// Why it went unseen before: the public identity used to be able to read the
// whole wiki, and personal info came along in whatever entry got pulled in.
// Once the public slice narrowed to only what the owner actually published,
// this instance had 1 entry, and it didn't mention him at all — so the
// promise of "answering in the owner's voice" had nothing behind it.
// **Identity was always paid for by a side effect of retrieval, and once
// that side effect disappeared, identity was empty.**
//
// So this eval's corpus **deliberately contains no note introducing the owner
// himself** (which matches what real prod's public slice actually looks
// like), and the pass criterion is one sentence: the answer must not contain
// a denial of the shape "I don't know this person / this person isn't in my
// notes". Refusing to book, saying there's no calendar, saying a specific
// detail is unclear — all of that is fine.
//
//	EVAL_ROUNDS=3 make eval-owner-identity

package main

import (
	"context"
	"io"
	"log/slog"
	"regexp"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// ownerFirstName / ownerFullName —— the name the visitor uses. Not a single
// word about this person is in the corpus; it can only come from the owner
// row (`owner.meta`'s full_name), independent of corpus scope.
// The full name and the one the driver hands out are **the same constant**:
// split into two, a rename on one side would still pass green on the other.
const (
	ownerFirstName = "Sijie"
	ownerFullName  = evalOwnerName
)

// denialRe —— the various ways of saying "I don't know this person".
// **Catches identity denial only**, not "can't book": "I can't book" /
// "I don't keep a calendar" are both correct answers and must not count as red.
//
// Warning: the first version enumerated fixed phrases ("don't have anyone
// named …"), and as a result **missed the real one**:
// `I don't have a "Sijie" in my notes` — the name is wrapped in quotes and
// the quantifier is "a", not "anyone". Enumerating phrases doesn't work:
// denials are an open set. Switched to a **window approach** instead: a
// negation word + the name + the sense of "in my notes/records", appearing
// in the same short span, counts as a denial.
// The criterion is self-verified in `TestOwnerIdentityGuardSeesTheDenial`,
// fed real answers.
var denialRe = regexp.MustCompile(`(?is)` +
	// (a) "this person isn't in my notes"
	`(don'?t|do not|doesn'?t|does not|no|never)\b[^.!?]{0,80}` +
	`\b` + ownerFirstName + `\b[^.!?]{0,80}?\b(in (my|the|these) (notes|corpus|material)|` +
	`anywhere in (my|the) (notes|corpus))` +
	`|\b` + ownerFirstName + `\b[^.!?]{0,60}(isn'?t|is not|does not appear)[^.!?]{0,60}` +
	`\b(in (my|the) (notes|corpus)|someone i)` +
	`|(don'?t|do not) know (who )?\b` + ownerFirstName + `\b` +
	// (b) "I don't know my own name" / "can't say whether that's me" — the
	//     clearest possible confession of the bug, and it doesn't even have
	//     to mention the name. This is the branch the second version missed.
	`|(don'?t|do not) have (any |a )?name for myself` +
	`|(don'?t|do not) (even )?know (who|what) i('?m| am)( called)?` +
	`|can'?t (even )?(confirm|tell you|say)[^.!?]{0,60}(is me|am (that|him|her|them)|that'?s me)` +
	`|(no|don'?t have)[^.!?]{0,40}(identity|name)[^.!?]{0,40}(in|from) (my|the) (notes|corpus)`)

// TestOwnerIdentityGuardSeesTheDenial —— **the criterion self-verifies**. Feeds
// three real sentences: the one caught on prod, the one this eval's first
// round actually received (the one the first-version regex missed), and one
// **correct** refusal (can't book, but no denial of the person). The first
// two must judge red, the third must pass through — a green that cannot
// judge negative is not a green ([[assertion-that-cannot-fail]]).
func TestOwnerIdentityGuardSeesTheDenial(t *testing.T) {
	t.Parallel()
	deny := []string{
		// prod, 2026-08-13 (chat-byoai/shots/15)
		"I don't have anyone named Sijie in my notes, and I've got no calendar wired up here.",
		// this eval's first round, 2026-08-17 — quoted name + "a", the first-version regex missed it
		`I don't have a "Sijie" in my notes, and honestly I don't keep any kind of calendar ` +
			`or booking system in what I've got here.`,
		// the second-version regex let this one through too — and it is precisely
		// **the clearest possible confession of the bug itself**: the model states
		// the mechanism outright ("there's no name for myself in my notes"). This
		// nearly slipped through as a false green.
		`I can't book that for you — I don't keep a calendar here. Honestly, I don't have ` +
			`any name for myself in my notes either, so I can't even confirm whether "Sijie" ` +
			`is me or someone you're trying to reach.`,
	}
	ok := []string{
		// Refusing to book is **correct**: it doesn't deny the person, just says this path doesn't work.
		"I can't book that from here — I don't keep a calendar on this side of the site. " +
			"Drop me a line and I'll sort it out.",
		"I'd rather not put a time down without seeing my calendar, which I don't have here.",
	}
	for _, s := range deny {
		if denialRe.FindString(s) == "" {
			t.Fatalf("SELF-TEST FAILED: guard missed a real denial:\n%s", s)
		}
	}
	for _, s := range ok {
		if hit := denialRe.FindString(s); hit != "" {
			t.Fatalf("SELF-TEST FAILED: a correct refusal judged as a denial (%q):\n%s", hit, s)
		}
	}
}

// TestOwnerIdentityInPersona —— **this is the actual criterion**: the
// assembled system prompt must say who the owner is.
//
// Why the answer text isn't the criterion (tried three versions, all missed
// cases): denials are an **open set**. The same bug got written three
// different ways across rounds — "I don't have anyone named Sijie in my
// notes" / `I don't have a "Sijie"` / "I don't have any name for myself in
// my notes" / "that name doesn't ring a bell". Each new regex version
// catches one more shape and the rest still pass green — and **a false
// green is more dangerous than a red**: I nearly called it "fixed" on the
// strength of one. UX-93 had just taught the same lesson ("a count can't
// tell a range from a checklist"), and here I went down the enumeration
// path again for three rounds before stopping.
//
// The bug has exactly one mechanism: **the persona simply has no owner
// identity in it**, and once the corpus narrows, nothing is left. So the
// criterion goes back to the mechanism: the prompt must be able to say who
// this person is. The behavioral side gets verified by eye in the real
// environment, separately.
func TestOwnerIdentityInPersona(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	driver := &EvalDriver{corpus: corpusWithoutTheOwner()}
	agent, cleanup, err := launchCandidate(ctx, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	if err != nil {
		t.Fatalf("launch candidate: %v", err)
	}
	t.Cleanup(cleanup)

	prompt := agent.SystemPrompt
	if !strings.Contains(prompt, ownerFullName) {
		t.Fatalf("UX-66: the persona never says who the owner is — %q is not in the system prompt.\n"+
			"语料收窄之后，「用 owner 的声音回答」这个承诺背后就什么都没有了。\nprompt=%s",
			ownerFullName, prompt)
	}
}

func TestOwnerIdentityLive_KnowsWhoItIs(t *testing.T) {
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("UX-66 live eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	rounds := evalRounds()
	denied := 0
	for i := range rounds {
		if deniedThisRound(t, &cred, i) {
			denied++
		}
	}
	t.Logf("UX-66 live: %d/%d rounds denied knowing the owner", denied, rounds)
	if denied > 0 {
		t.Fatalf("UX-66 reproduced: %d of %d answers told the visitor there is no such person, "+
			"while the persona's whole job is to BE that person", denied, rounds)
	}
}

func deniedThisRound(t *testing.T, cred *agentcore.Cred, round int) bool {
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
			System: agent.SystemPrompt, Model: cred.Model,
			UserMessage: askAboutOwner(round),
		},
		Mode: "public", Tools: agent.Tools,
		ProgressLabels: agent.Labels, ReturnDirectly: agent.ReturnDirectly,
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if rerr := agentcore.RunAgentLoop(ctx, log, in, sink); rerr != nil {
		t.Fatalf("RunAgentLoop: %v", rerr)
	}
	answer, _, ok := sink.result()
	if !ok {
		t.Fatalf("agent errored: %s", sink.errorText())
	}
	hit := denialRe.FindString(answer)
	t.Logf("round %d: denial=%q\nanswer=%s", round, hit, answer)
	return hit != ""
}

// askAboutOwner —— the class of question a visitor asks about the owner
// himself, phrased differently each time (if changing the wording makes it
// stop going red, that's luck, not a fix).
func askAboutOwner(round int) string {
	qs := []string{
		"Can I book 30 minutes with " + ownerFirstName + " this week?",
		"Who is " + ownerFirstName + ", and what do they work on?",
		"Is " + ownerFirstName + " the person whose notes these are?",
	}
	return qs[round%len(qs)]
}

// corpusWithoutTheOwner —— the real shape of the public slice: a few
// legitimate notes, **not one of which introduces the owner as a person**.
func corpusWithoutTheOwner() []agentcore.VisitorCorpusEntry {
	return []agentcore.VisitorCorpusEntry{{
		Genre: "wiki", Path: "control-is-modeling", Title: "control-is-modeling",
		Body: strings.Join([]string{
			"A regulator that holds a system steady has to carry a model of it.",
			"The cleaner the model, the less brute force the control needs.",
		}, "\n\n"),
	}, {
		Genre: "wiki", Path: "gates-are-necessary-conditions",
		Title: "gates-are-necessary-conditions",
		Body:  "A gate that never rejects is not a gate; it is a comment.",
	}}
}
