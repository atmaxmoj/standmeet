// deps_wired_test.go — the self-proof for AssertDepsWired.
//
// Same convention as every `--self-test` gate under infra/scripts: **a check that never
// goes red is the same as having no check**. What's planted here isn't just any empty
// struct, but the actual line missed on 2026-08-31 — `buildAdminHandlers` failed to copy
// over the `EmailChange:` line, so the owner hit a nil-pointer panic clicking the
// confirmation link, and the UI displayed it as "this link is invalid".

package admin_test

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/depcheck"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/admin"
)

// stubSender — exists only to put a non-nil value in the Proxy slot; its method bodies
// are never actually invoked. Uses Proxy rather than Owners: Owners is the concrete
// *repo.Repo, and the routes layer isn't allowed to import repo (the domain's guts only
// come out through the facade) — building a real Repo would poke through that boundary
// just for the test.
type stubSender struct{}

func (stubSender) Connected(context.Context, string) (bool, error)          { return false, nil }
func (stubSender) Send(context.Context, string, owner.OutboundNotice) error { return nil }
func (stubSender) ChannelName() string                                      { return "stub" }

func TestAssertDepsWiredFlagsTheLineThatWasActuallyMissed(t *testing.T) {
	t.Parallel()
	// The shape of the missed copy, using **the real type**: this dep group has no
	// member assigned at all.
	if !depcheck.AllNilMembers(reflect.ValueOf(owner.EmailChangeDeps{})) {
		t.Fatal("EmailChange with nothing wired was reported as wired — " +
			"that is exactly the shape of the line that was missed")
	}
	// Once it's wired, this must stop reporting, or the check would block a legitimate
	// boot. As long as one member is non-nil, someone has assigned a value.
	if depcheck.AllNilMembers(reflect.ValueOf(owner.EmailChangeDeps{Proxy: stubSender{}})) {
		t.Fatal("a wired dep group was reported as unwired — this check would block a good boot")
	}
}

func TestAssertDepsWiredNamesTheField(t *testing.T) {
	t.Parallel()
	err := (&admin.Handlers{}).AssertDepsWired()
	if err == nil {
		t.Fatal("nothing was wired at all, and the check said it was fine")
	}
	// The error must name **which group** — otherwise whoever reads it still has to
	// diff the whole field table themselves.
	if !strings.Contains(err.Error(), "EmailChange") {
		t.Fatalf("the error does not name EmailChange, so nobody can act on it: %v", err)
	}
}
