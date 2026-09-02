// slots_restated_live_test.go —— UX-93's guard: **the slots card already laid the times
// out, so the answer must not list them again**.
//
// Why this has to be an eval, not a spec: this defect happens when **the model writes
// its own prose** — a mock LLM only ever returns the line the test registered
// ([[mock-llm-pure-registration-kv]]) — drive it with a mock and the defendant simply
// never shows up. So, same as F-A-37: a real model, a real booker plugin (backed by a
// canned calendar), a real agent loop.
//
// The judgment is on **shape, not count**, and that came out of actually driving it:
//
//   - The first version counted clock times, with the line drawn at "at most 1". Once
//     that was fixed and driven again, the model wrote "availability runs from
//     5:00 AM to 2:00 PM, pick from the picker" — two endpoints; another round wrote
//     the same window once per timezone — four endpoints. Those are all **ranges**,
//     answering "when are you free", and the dual timezone is exactly what
//     booking-slots check 4 requires. A count-based ruler can't tell "range" from
//     "list" apart — it would just keep pushing the threshold up, which is fitting
//     the data to get green.
//   - The defect's real shape is **enumeration**: lines like `• 9:30 AM (right before
//     your requested time)` listed one by one, and only some of them — the card is
//     complete, this is truncated, and the reader has to guess which one counts.
//
// So the judgment is: in the round where the card appeared, the answer **must not have
// any list line that starts with a time**. Ranges can be written however.
//
//	EVAL_ROUNDS=5 make eval-slots-restated

package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// clockTimeRe —— clock times in the answer body: `9:30 AM` / `09:30` / `3 PM`. Dates don't count.
var clockTimeRe = regexp.MustCompile(`\b\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)?|\b\d{1,2}\s*[AaPp]\.?[Mm]\.?\b`)

// timeListLineRe —— a line that's **a list item starting with a time**: `- 9:30 AM …` /
// `• 10:00 …` / `1. 2:00 PM …` / `9:30 AM — right before your requested time`. This is
// exactly the shape caught on prod.
var timeListLineRe = regexp.MustCompile(
	`(?m)^\s*(?:[-*•‣]|\d+[.)])?\s*\**\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?\**\s*(?:[-–—:(]|$)`)

// timeListMin —— how many lines counts as "turned into a list". Two lines could still be
// a "the slot before / after" phrasing answering a specific question; three or more is
// re-copying the card's list (and usually a truncated copy of it).
const timeListMin = 3

// TestSlotsRestatedGuardSeesTheDefect —— **the judgment's self-test**: now that it's
// been switched to "shape", does it still recognize the original defect? Fed the two
// snippets actually caught on prod (bullet list / numbered list), it must judge
// ≥ timeListMin lines; and the "range" style the model writes after the fix must judge
// zero lines. A green that can't go red is no green at all
// ([[assertion-that-cannot-fail]]).
func TestSlotsRestatedGuardSeesTheDefect(t *testing.T) {
	t.Parallel()
	// prod (2026-08-17, bbook-26): the card had 17 slots, the prose listed four again.
	const prodBulleted = "That 10:00 AM slot is already taken, so I can't book it as-is. " +
		"Here are the closest open 30-minute slots that morning (all Eastern):\n\n" +
		"- **9:30 AM** (right before your requested time)\n" +
		"- **10:30 AM** (right after)\n" +
		"- **11:00 AM**\n" +
		"- **11:30 AM**\n\n" +
		"Want me to grab one of those?"
	// The post-fix style: one range, pointing at the picker.
	const windowOnly = "Here you go — the available 30-minute slots for Monday, August 24 are in " +
		"the picker above. They run from 5:00 AM through 2:00 PM your time (America/Toronto). " +
		"Go ahead and pick one."
	// Stating that same range once per timezone — also correct (booking-slots check 4
	// requires both timezones).
	const windowBothZones = "The picker above has them. Availability runs 5:00 AM–2:00 PM your " +
		"time, which is 9:00 AM–6:00 PM mine."

	if n := len(timeListLineRe.FindAllString(prodBulleted, -1)); n < timeListMin {
		t.Fatalf("SELF-TEST FAILED: the guard no longer sees the real defect (%d list lines < %d)", n, timeListMin)
	}
	for name, ok := range map[string]string{"window": windowOnly, "both zones": windowBothZones} {
		if n := len(timeListLineRe.FindAllString(ok, -1)); n >= timeListMin {
			t.Fatalf("SELF-TEST FAILED: %q (a correct answer) judged as a list (%d lines)", name, n)
		}
	}
}

func TestSlotsRestatedLive_CardIsTheList(t *testing.T) {
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("UX-93 live eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	rounds := evalRounds()
	restated, withCard := 0, 0
	for i := range rounds {
		listed, sawCard := restatedThisRound(t, &cred, i)
		if sawCard {
			withCard++
		}
		if listed {
			restated++
		}
	}
	if withCard == 0 {
		t.Fatalf("no round produced a slots card — the guard never got to judge anything "+
			"(rounds=%d). A green here would mean nothing.", rounds)
	}
	t.Logf("UX-93 live: %d/%d rounds with a card restated the times", restated, withCard)
	if restated > 0 {
		t.Fatalf("UX-93 reproduced: %d of %d turns re-listed the slot times in prose while the "+
			"card was already showing them", restated, withCard)
	}
}

// restatedThisRound —— one full real turn. Returns (whether the answer re-listed the
// slots, whether this round produced a card at all).
func restatedThisRound(t *testing.T, cred *agentcore.Cred, round int) (bool, bool) {
	t.Helper()
	ctx := context.Background()
	agent, _ := launchWithBookerCred(t, ctx, cred, "")

	sink := newCaptureSink()
	in := &agentcore.AgentTurnInput{
		Cred: cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, Model: cred.Model,
			ConversationID:  "c1",
			VisitorTimezone: "America/Toronto",
			UserMessage:     slotsRequest(round),
		},
		Mode: "code", Tools: agent.Tools,
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
	sawCard := calledListSlots(tools)
	listLines := timeListLineRe.FindAllString(answer, -1)
	times := clockTimeRe.FindAllString(answer, -1)
	// Both numbers are logged: the judgment is on listLines (shape); times is only a
	// side signal for a log reader to gauge how verbose this round actually was.
	t.Logf("round %d: tools=%d card=%v time_list_lines=%d times_mentioned=%d %v\nanswer=%s",
		round, len(tools), sawCard, len(listLines), len(times), times, answer)
	return sawCard && len(listLines) >= timeListMin, sawCard
}

// calledListSlots —— whether this round actually produced a slots card.
func calledListSlots(tools []toolUse) bool {
	for i := range tools {
		if tools[i].Name == "calendar_list_slots" {
			return true
		}
	}
	return false
}

// slotsRequest —— the phrasing a visitor actually asks with on prod. The day shifts
// with the round to avoid asking about the same day every time.
func slotsRequest(round int) string {
	day := weekdayAhead(7 + round)
	return fmt.Sprintf(
		"What 30-minute slots do you have on %s? I'm in America/Toronto.",
		day.Format("Monday January 2"))
}

var _ = time.Now
