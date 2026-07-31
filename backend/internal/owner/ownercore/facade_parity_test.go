package ownercore_test

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
	"github.com/atmaxmoj/standmeet/internal/owner/ownercore"
)

const liveToolCap = 64

// TestFacadeParity_MCPGapsRatchet —— the facade-parity enforcement gate, live against the REAL
// owner-MCP
// facade. It builds the actual capreg registry (every ownercore capability), pulls the live MCP
// tool
// names, and asserts the set of manifest ops that SHOULD be on MCP but aren't equals the tracked
// paydown baseline exactly. This ratchets both directions:
// - add an admin capability without its MCP twin (or a manifest entry) → the gap set changes →
// RED,
//
//	  so no new facade omission is ever silent (the whole point of docs/design/facade-parity.md);
//	- fill a gap (ship the MCP tool) → delete its line from KnownMCPGaps → GREEN.
//
// The baseline can only ever SHRINK.
func TestFacadeParity_MCPGapsRatchet(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	p := ownercore.New(&ownercore.Deps{})
	p.RegisterCapabilities(reg)

	live := make([]string, 0, liveToolCap)
	for _, b := range reg.OwnerMCPBindings() {
		live = append(live, b.Name)
	}

	require.ElementsMatch(t, paritymanifest.KnownMCPGaps(), paritymanifest.MCPMissing(live),
		"facade-parity ratchet broke.\n"+
			"• Added an admin capability? add its owner-MCP twin (or the manifest Entry) —\n"+
			"  never grow the baseline.\n"+
			"• Filled a gap? delete its line from paritymanifest.KnownMCPGaps.\n"+
			"• Renamed an MCP tool? update its manifest Entry.")
}

// TestFacadeParity_EveryLiveMCPToolIsInManifest —— orphan guard: every owner-MCP tool the registry
// actually exposes must be claimed by a manifest Entry (so the manifest is a complete source of
// truth,
// not a stale subset). A new MCP tool with no manifest home → RED.
func TestFacadeParity_EveryLiveMCPToolIsInManifest(t *testing.T) {
	t.Parallel()
	reg := capreg.NewRegistry()
	p := ownercore.New(&ownercore.Deps{})
	p.RegisterCapabilities(reg)

	claimed := map[string]bool{}
	for _, e := range paritymanifest.Manifest() {
		for _, tool := range e.MCP {
			claimed[tool] = true
		}
	}
	for _, b := range reg.OwnerMCPBindings() {
		require.True(t, claimed[b.Name],
			"owner-MCP tool %q is not in the facade-parity manifest — add an Entry for it", b.Name)
	}
}
