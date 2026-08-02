package main

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
)

// TestParityPluginClaimsAreReal —— every owner-MCP tool the parity manifest marks Plugin must
// actually be declared by a built-in plugin manifest's OwnerTools.
//
// Why here: the ownercore-scoped parity ratchet cannot see the plugin axis, so a tool that moved
// from ownercore into an externalized capability would read as a "gap". Entry.Plugin says "no, it
// is served — just over there". That claim needs a keeper, or it becomes a way to silence the
// ratchet: mark an op Plugin, delete the tool, stay green. This test is that keeper, and it lives
// in the composition root because that is where the built-in manifests are declared.
//
// Delete calendar.list_slots from bookerManifest().OwnerTools and this goes RED.
func TestParityPluginClaimsAreReal(t *testing.T) {
	t.Parallel()

	declared := map[string]string{} // owner tool name -> declaring capability id
	for _, m := range builtinManifests() {
		for _, ot := range m.OwnerTools {
			declared[ot.Name] = m.ID
		}
	}

	claimed := paritymanifest.PluginServedMCP()
	require.NotEmpty(t, claimed,
		"no op is marked Plugin — if that is intentional, delete this test")
	for _, name := range claimed {
		capID, ok := declared[name]
		require.Truef(t, ok,
			"parity manifest marks %q as plugin-served, but no built-in manifest declares it in "+
				"OwnerTools — either the plugin lost the tool, or the Plugin marker is wrong", name)
		require.NotEmptyf(t, capID, "%q declared by a manifest with no id", name)
	}
}

// TestBuiltinOwnerToolsAreClaimed —— the reverse direction: an owner tool a plugin declares must be
// claimed by a manifest entry, so the parity manifest stays a complete source of truth rather than
// a stale subset (the same orphan guard ownercore's tools get).
func TestBuiltinOwnerToolsAreClaimed(t *testing.T) {
	t.Parallel()

	claimed := map[string]bool{}
	for _, e := range paritymanifest.Manifest() {
		for _, tool := range e.MCP {
			claimed[tool] = true
		}
	}
	for _, m := range builtinManifests() {
		for _, ot := range m.OwnerTools {
			require.Truef(t, claimed[ot.Name],
				"plugin %q declares owner tool %q, but no parity manifest Entry claims it",
				m.ID, ot.Name)
		}
	}
}
