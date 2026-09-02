// agent_instruction_datetime_test.go —— the generic instruction **must not name any specific
// capability**.
//
// What the kernel assembles here is "the current time, owner's timezone, visitor's timezone" —
// added on every turn, regardless of which capabilities the visitor was granted. It used to keep
// saying "the owner's **calendar** runs in this timezone" and "before proposing or
// **scheduling** times": so a visitor never granted the booking capability still had a
// scheduling instruction sitting in their system prompt. That was the last entry left on the
// check-core-agnostic baseline (conversation/inference/agent_instruction.go<TAB>calendar).
//
// The timezone context itself is generic (résumé, experience, "recent" all need to anchor to
// today) — what had to move out is **that instruction sentence**: how to convert, when to ask
// back, whether to show both, that's the business of the capability that actually schedules, said
// in its own instructions.
//
// The two assertion groups below are a pair, neither optional on its own:
//   - it says what it should (the date, the owner's timezone, anchoring "today", stating the
//     visitor's timezone as a fact)
//   - it doesn't say what it shouldn't (any specific capability word)
// With only the second group, deleting the whole section would also pass — that would be a test
// that lets itself off the hook.

package inference

import (
	"strings"
	"testing"
	"time"
)

const (
	dtPersona = "You are the owner's voice."
	ownerTZ   = "America/Toronto"
	dtYear    = 2026
	dtDay     = 5
	dtHour    = 14
	dtMinute  = 30
)

// dtNow —— a fixed "now". The date itself doesn't matter; what matters is that it must appear
// verbatim in that context block (the "2026-08-05" asserted below is it).
func dtNow() time.Time {
	return time.Date(dtYear, time.August, dtDay, dtHour, dtMinute, 0, 0, time.UTC)
}

// Words naming specific capabilities. The kernel's section here must contain none of them —
// it doesn't know what the visitor was granted.
var capabilityWords = []string{
	"calendar", "schedul", "booking", "book a", "meeting", "appointment",
}

func TestInstructionWithDateTime_NamesNoCapability(t *testing.T) {
	t.Parallel()
	now := dtNow()
	for _, visitorTZ := range []string{"", "Europe/Berlin", ownerTZ} {
		got := instructionWithDateTime(dtPersona, now, ownerTZ, visitorTZ)
		lower := strings.ToLower(got)
		for _, w := range capabilityWords {
			if strings.Contains(lower, w) {
				t.Errorf("visitor_tz=%q: the always-on datetime context names a capability (%q). "+
					"A visitor who was never granted booking still carries this in their "+
					"system prompt; how to convert and when to ask belongs to the capability "+
					"that schedules.\n--- instruction ---\n%s", visitorTZ, w, got)
			}
		}
	}
}

// What should be said still has to be said — otherwise "contains no 'calendar'" could be
// satisfied by deleting the whole section.
func TestInstructionWithDateTime_StillAnchorsNow(t *testing.T) {
	t.Parallel()
	got := instructionWithDateTime(dtPersona, dtNow(), ownerTZ, "")

	for _, want := range []string{
		dtPersona,          // the original persona must not be swallowed
		"2026-08-05",       // what today's date is
		ownerTZ,            // the owner's timezone
		"nearest upcoming", // a yearless date anchors to the future, not some past training year
	} {
		if !strings.Contains(got, want) {
			t.Errorf("datetime context lost %q:\n%s", want, got)
		}
	}
}

// The visitor's timezone is a **fact**, not an instruction: state it when known, say nothing when
// not (whether to ask back over it is the scheduling capability's call).
func TestVisitorTZClause_StatesAFactOrNothing(t *testing.T) {
	t.Parallel()
	if got := visitorTZClause("", ownerTZ); got != "" {
		t.Errorf("unknown visitor timezone should add nothing to the generic context, got %q", got)
	}
	same := visitorTZClause(ownerTZ, ownerTZ)
	if !strings.Contains(same, "same timezone") {
		t.Errorf("same-timezone visitor should be stated plainly, got %q", same)
	}
	diff := visitorTZClause("Europe/Berlin", ownerTZ)
	if !strings.Contains(diff, "Europe/Berlin") {
		t.Errorf("known visitor timezone must be stated, got %q", diff)
	}
}
