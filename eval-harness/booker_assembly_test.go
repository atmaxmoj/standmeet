// booker_assembly_test.go —— the eval mini-host mounts the REAL booker plugin.
//
// Booking coverage died in P.13: the eval moved onto agentcore.Driver, `LaunchInput` never got a
// booking hook, and the booker had become a sandboxed plugin — so five capability asserts spent
// six weeks asserting a tool nobody mounted. This is the mechanism that brings it back: build the
// booker binary, start a host socket that serves the ops ITS OWN MANIFEST orders (backed by a
// canned calendar + in-memory store), and let the same assembly prod uses discover it.
//
// The assertion is not "a tool named calendar_book exists" — it is that invoking it reaches the
// canned calendar and leaves a booking record. A tool that assembles and then fails on every call
// would satisfy the weaker one.

package main

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// bookerCapID —— the shipped capability id; the manifest under that id decides host ops / ACL /
// tool naming, so this test cannot drift from what prod declares.
const bookerCapID = "calendar.book"

func TestEvalAssemblesBookerPlugin(t *testing.T) {
	ctx := context.Background()
	agent, store := launchWithBooker(t, ctx, "")
	names := agentToolNames(t, agent)
	for _, want := range []string{"calendar_book", "calendar_list_slots"} {
		if !contains(names, want) {
			t.Fatalf("%s not assembled from the real booker plugin; got %v", want, names)
		}
	}
	if n := len(store.rows("bookings")); n != 0 {
		t.Fatalf("nothing booked yet, store has %d", n)
	}
}

// TestEvalBookerBooksThroughTheCannedCalendar —— invoke the tool for real: it must reach the
// canned connector (event inserted) and persist a booking in the capability's own store.
func TestEvalBookerBooksThroughTheCannedCalendar(t *testing.T) {
	ctx := context.Background()
	agent, store := launchWithBooker(t, ctx, "")
	out := invokeTool(t, agent, "calendar_book", bookArgs(bookableSlot(time.Now())))
	if strings.Contains(out, `"ok":false`) {
		t.Fatalf("booking refused by the canned calendar: %s", out)
	}
	docs := store.rows("bookings")
	if len(docs) != 1 {
		t.Fatalf("booking not persisted in the capability store: %d docs (%s)", len(docs), out)
	}
	var doc map[string]any
	if err := json.Unmarshal(docs[0].Doc, &doc); err != nil {
		t.Fatalf("stored booking is not JSON: %v", err)
	}
	if doc["google_event_id"] == "" || doc["google_event_id"] == nil {
		t.Fatalf("the stored booking carries no calendar event id: %v", doc)
	}
}

// TestEvalBookerSurfacesACalendarFailure —— when the calendar refuses the insert, the tool must
// say so rather than claim a booking. This is the path the "no loop" assert rides on.
func TestEvalBookerSurfacesACalendarFailure(t *testing.T) {
	ctx := context.Background()
	agent, store := launchWithBooker(t, ctx, "calendar.insert_event")
	out := invokeTool(t, agent, "calendar_book", bookArgs(bookableSlot(time.Now())))
	if !strings.Contains(strings.ToLower(out), "error") && !strings.Contains(out, `"ok":false`) {
		t.Fatalf("a failed insert must be reported, got: %s", out)
	}
	if n := len(store.rows("bookings")); n != 0 {
		t.Fatalf("a failed insert must leave no booking record, got %d", n)
	}
}

// launchWithBooker —— build the plugin, start its host socket, launch a code-mode agent with it.
// failVerb != "" makes that one connector verb fail. Uses the offline cred: these asserts invoke
// tools directly and never reach a model.
func launchWithBooker(
	t *testing.T, ctx context.Context, failVerb string,
) (*agentcore.VisitorAgent, *memStore) {
	t.Helper()
	c := evalCred()
	return launchWithBookerCred(t, ctx, &c, failVerb)
}

// launchWithBookerCred —— same mini-host, with the caller's credential. The live evals need a real
// one because they drive the model's own decision to call the tool (F-A-37), not the tool itself.
func launchWithBookerCred(
	t *testing.T, ctx context.Context, cred *agentcore.Cred, failVerb string,
) (*agentcore.VisitorAgent, *memStore) {
	t.Helper()
	host, store := bookingWorld("owner-1", "UTC", nil, failVerb, "the calendar refused this call")
	bin := buildHostPlugin(t, "../mcp-servers/booker")
	// short /tmp path — macOS caps unix socket paths at ~104 bytes.
	sockDir, derr := os.MkdirTemp("/tmp", "smb")
	if derr != nil {
		t.Fatalf("sock dir: %v", derr)
	}
	t.Cleanup(func() { _ = os.RemoveAll(sockDir) })
	sock := filepath.Join(sockDir, "b.sock")

	spec, serr := agentcore.BuiltinPluginSpec(bookerCapID, bin, sock)
	if serr != nil {
		t.Fatalf("BuiltinPluginSpec: %v", serr)
	}
	stop, herr := agentcore.StartCapabilitySocket(ctx, host, bookerCapID, sock)
	if herr != nil {
		t.Fatalf("StartCapabilitySocket: %v", herr)
	}
	t.Cleanup(func() { _ = stop() })

	driver := &EvalDriver{cred: *cred, plugins: []agentcore.PluginSpec{spec}}
	agent, err := agentcore.BuildVisitorAgent(ctx, driver, &agentcore.LaunchInput{
		OwnerID: host.OwnerID, Mode: "code", ConversationID: "c1", CodeID: "code-1",
		// booker is acl=role_granted:role — exposed only once granted (same gate as prod).
		GrantedCapabilities: []string{bookerCapID},
	})
	if err != nil {
		t.Fatalf("BuildVisitorAgent: %v", err)
	}
	return agent, store
}

// bookArgs —— args matching the plugin's schema (preferred_times is a **list**:
// the visitor offers a few candidates, the plugin picks the first that clears policy).
func bookArgs(slot time.Time) string {
	args, _ := json.Marshal(map[string]any{
		"preferred_times": []string{slot.Format(time.RFC3339)},
		"duration_min":    30,
		"topic":           "Senior backend role",
	})
	return string(args)
}
