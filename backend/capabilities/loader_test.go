// loader_test.go — the built-in capabilities' declarations really do Load at
// startup, and **no path ever appears in a declaration**.
//
// These two things are the whole point of this externalization: a capability
// says "which things I need", and the host derives the one socket it can reach.
// The moment a path shows up in a declaration again, the mechanism has regressed
// to the original setup (just wearing a different file format).

package capabilities_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// TestLoad_DerivesTheSocketPath — a capability that ordered a host op gets a
// socket **derived from its id**; one that ordered none is fully offline (not
// even the env var is set).
func TestLoad_DerivesTheSocketPath(t *testing.T) {
	t.Parallel()
	ms := mustLoad(t)

	booker := mustFind(t, ms, "calendar.book")
	got := booker.Transport.Env["STANDMEET_HOST_SOCKET"]
	if want := "/run/standmeet/calendar.book.sock"; got != want {
		t.Errorf("booker socket = %q, want %q (derived from the id, not authored)", got, want)
	}

	ask := mustFind(t, ms, "ask_visitor")
	if len(ask.Transport.Sandbox.HostOps) != 0 {
		t.Fatalf("ask_visitor should order no host ops, got %v", ask.Transport.Sandbox.HostOps)
	}
	if p, ok := ask.Transport.Env["STANDMEET_HOST_SOCKET"]; ok {
		t.Errorf("ask_visitor got a host socket %q — it ordered nothing, so it reaches nothing", p)
	}
}

// TestLoad_NoPathsInTheDeclarations — a socket path must never appear in a
// declaration again.
//
// This is exactly what this round changed: the manifest used to say "mount me
// this file", and a filename can't answer "what's on it". The host was therefore
// stuck hand-writing four gateways.
func TestLoad_NoPathsInTheDeclarations(t *testing.T) {
	t.Parallel()
	for _, m := range mustLoad(t) {
		for _, op := range m.Transport.Sandbox.HostOps {
			if strings.Contains(op, "/") {
				t.Errorf("%s orders %q — host ops are NAMES from a fixed vocabulary, not paths",
					m.ID, op)
			}
		}
	}
}

// TestLoad_OwnerToolSchemasAreValidJSON — an unmarshalable schema fails marshaling
// for the whole owner tool table (this really happened before: one bad
// InputSchema emptied out tools/list). The loader rejects it right at startup.
func TestLoad_OwnerToolSchemasAreValidJSON(t *testing.T) {
	t.Parallel()
	for _, m := range mustLoad(t) {
		for i := range m.OwnerTools {
			if !json.Valid([]byte(m.OwnerTools[i].InputSchema)) {
				t.Errorf("%s owner tool %q: input_schema is not valid JSON",
					m.ID, m.OwnerTools[i].Name)
			}
		}
	}
}

// TestLoad_QuotaIsCompleteOrAbsent — a usage declaration is either all three
// fields filled in, or absent entirely. A half-written declaration leaves the
// host unable to count usage, and "can't count" and "no cap" are two different
// things.
func TestLoad_QuotaIsCompleteOrAbsent(t *testing.T) {
	t.Parallel()
	for _, m := range mustLoad(t) {
		if m.Quota != nil && !m.Quota.Usable() {
			t.Errorf("%s has a half-written quota declaration: %+v", m.ID, m.Quota)
		}
	}
}

// TestLoad_QuotaKeyIsDeclaredOnTheCode — the key a usage cap points at must
// actually be a field this capability declared in code. Pointing at a key that
// doesn't exist = the cap can never be read = silently ungated.
func TestLoad_QuotaKeyIsDeclaredOnTheCode(t *testing.T) {
	t.Parallel()
	for _, m := range mustLoad(t) {
		if m.Quota == nil {
			continue
		}
		if !hasField(m.CodeConfig, m.Quota.ConfigKey) {
			t.Errorf("%s quota reads %q, which it never declares in code_config",
				m.ID, m.Quota.ConfigKey)
		}
	}
}

func hasField(decl []mcpplugin.ConfigField, key string) bool {
	for i := range decl {
		if decl[i].Key == key {
			return true
		}
	}
	return false
}

func mustLoad(t *testing.T) []mcpplugin.Manifest {
	t.Helper()
	ms, err := capabilities.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(ms) == 0 {
		t.Fatal("Load returned no built-in capabilities")
	}
	return ms
}

func mustFind(t *testing.T, ms []mcpplugin.Manifest, id string) *mcpplugin.Manifest {
	t.Helper()
	for i := range ms {
		if ms[i].ID == id {
			return &ms[i]
		}
	}
	t.Fatalf("built-in capability %q not found", id)
	return nil
}
