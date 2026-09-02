// pertool_requires_test.go — F-B-8: both spellings of `visitor_tools` must be
// accepted, and **both must carry test coverage**.
//
// What this guards is not "can it parse", it's **granularity**: under a
// read-only grant, the booking actions are the ones that should disappear,
// while "list slots" must stay — that action was already fine read-only, and
// hiding it too would trade one defect for another.

package capabilities_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

const (
	insertScope = "calendar:events.insert"
	deleteScope = "calendar:events.delete"
	// bookerVisitorTools — the count of tools booker offers the visitor. Hardcoding
	// it is deliberate: if this number changes, someone added or removed an action
	// the visitor can trigger, and that deserves a human look.
	bookerVisitorTools = 7
)

func TestBothSpellingsParse(t *testing.T) {
	t.Parallel()
	// Mixed spellings (bare names + mappings) must not drop any entry.
	if got := loadBooker(t).VisitorTools; len(got) != bookerVisitorTools {
		t.Fatalf("visitor tool names = %v, want all %d", got, bookerVisitorTools)
	}
}

func TestWriteToolsNameTheActionTheyNeed(t *testing.T) {
	t.Parallel()
	reqs := loadBooker(t).VisitorToolRequires
	for tool, want := range map[string]string{
		"calendar_book":           insertScope,
		"calendar_cancel":         deleteScope,
		"calendar_cancel_booking": deleteScope,
	} {
		if got := reqs[tool]; len(got) != 1 || got[0] != want {
			t.Errorf("%s requires = %v, want [%s]", tool, got, want)
		}
	}
}

func TestReschedulingNeedsBothActions(t *testing.T) {
	t.Parallel()
	// Rescheduling = delete the old one, then insert the new one.
	if got := loadBooker(t).VisitorToolRequires["calendar_reschedule"]; len(got) != 2 {
		t.Errorf("calendar_reschedule requires = %v, want both insert and delete", got)
	}
}

// ★ This one is this file's real reason to exist: **read actions must never be
// caught up in this**. They carry no extra requirement, so they must still be
// there under a read-only grant — hiding them along with the writes removes an
// action that already worked.
func TestReadToolsCarryNoExtraRequirement(t *testing.T) {
	t.Parallel()
	reqs := loadBooker(t).VisitorToolRequires
	for _, tool := range []string{"calendar_list_slots", "bookings_list"} {
		if got, ok := reqs[tool]; ok {
			t.Errorf("%s is a read; it must carry no extra requirement, got %v", tool, got)
		}
	}
}

func loadBooker(t *testing.T) mcpplugin.Manifest {
	t.Helper()
	ms, err := capabilities.Load()
	if err != nil {
		t.Fatalf("load builtin capabilities: %v", err)
	}
	for i := range ms {
		if ms[i].ID == "calendar.book" {
			return ms[i]
		}
	}
	t.Fatal("calendar.book not among the builtin capabilities")
	return mcpplugin.Manifest{}
}
