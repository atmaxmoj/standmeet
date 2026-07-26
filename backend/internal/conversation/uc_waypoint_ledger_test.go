// waypoint_ledger_test.go —— white-box unit for the ledger's terminal-marking signal (#135 ghost
// booking-decoupling). The kernel no longer names booking: inference reports the successful tool
// names, the route matches the external terminal tool (calendar_book) into TerminalOK, and this
// ledger marks terminal waypoints visited on TerminalOK. Locks that signal → marking mapping.

package conversation

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/stretchr/testify/require"
)

func TestMarkAllTerminalOnSignal(t *testing.T) {
	t.Parallel()
	wps := []access.Waypoint{
		{WaypointID: "learn-x", IsTerminal: false},
		{WaypointID: "book-call", IsTerminal: true},
	}
	visited := newStringSet(nil)

	changed := markAll(&MarkWaypointsInput{TerminalOK: true}, wps, nil, visited)

	require.True(t, changed, "a terminal signal must mark something")
	require.True(t, visited.has("book-call"), "terminal waypoint marked visited on TerminalOK")
	require.False(t, visited.has("learn-x"), "non-terminal not marked by terminal signal")
}

func TestMarkAllNoTerminalWhenSignalOff(t *testing.T) {
	t.Parallel()
	wps := []access.Waypoint{{WaypointID: "book-call", IsTerminal: true}}
	visited := newStringSet(nil)

	changed := markAll(&MarkWaypointsInput{TerminalOK: false}, wps, nil, visited)

	require.False(t, changed, "no terminal signal → no terminal marking")
	require.False(t, visited.has("book-call"))
}
