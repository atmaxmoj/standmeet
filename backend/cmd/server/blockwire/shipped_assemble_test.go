package blockwire

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// TestShippedSuppliersAssemble —— every block we ship that declares a seam must actually
// assemble through the real assembler.
//
// This is the keeper for a defect that reached a running instance: `binding.yaml` said
// `category: calendar` while the Go struct had been renamed to read `seam`. The YAML was
// valid, the file parsed, the field came back "", and `assembleSupplier` refused it. Boot
// logged one ERROR and carried on — so the instance came up **healthy with no calendar**,
// and booking was dead with nothing on screen to say so.
//
// Two things now stop that. `DepRegistry` panics instead of logging, so a broken shipped
// block cannot boot. And this test fails the same break in seconds, at the place where the
// data is declared, without waiting for a container to come up.
//
// It uses the real `supplierManifests()` and the real `assembleSupplier` — nothing about
// the manifest shape is restated here. Restating it is how a test keeps passing against a
// field the product no longer reads, which is the very bug being guarded.
//
// Rename `seam:` back to `category:` in backend/blocks/google-calendar/binding.yaml and
// this goes RED.
func TestShippedSuppliersAssemble(t *testing.T) {
	t.Parallel()

	manifests := supplierManifests()
	require.NotEmpty(t, manifests,
		"no shipped block declares a seam — the scan is blind, not the tree clean")

	adeps := newAssembleDeps(nil)
	for i := range manifests {
		m := &manifests[i]
		t.Run(m.ID, func(t *testing.T) {
			t.Parallel()
			require.NotEmpty(t, m.Seam,
				"%s supplies a seam in its manifest but the assembled seam is empty —"+
					" a declaration field the loader does not read", m.ID)
			_, err := assembleSupplier(m, adeps)
			require.NoError(t, err, "shipped supplier %s does not assemble", m.ID)
		})
	}
}
