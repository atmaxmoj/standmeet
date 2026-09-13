// base_seams_test.go — the `db` base seam is registered, always-connected, and a valid
// Requires name (so a block declaring `requires: [db]` is boot-accepted and never
// seam-hidden). everything-is-a-block.md rule 3.

package blockwire

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
	"github.com/atmaxmoj/standmeet/internal/routes/blockload"
)

func TestRegisterBaseSeams_DBAlwaysConnected(t *testing.T) {
	t.Parallel()
	depReg := registry.NewDepRegistry()
	// The base providers are assembled here and registered through the one door — the same
	// path boot uses (everything-is-a-block.md rule 2).
	blockload.RegisterSeamProviders(depReg, baseSeamProviders())

	p, ok := depReg.Lookup("db")
	require.True(t, ok, "db seam must be registered")

	connected, err := p.Connected(context.Background(), "any-owner")
	require.NoError(t, err)
	require.True(t, connected, "db is the instance's own Postgres — always connected")

	// Boot validation accepts `requires: [db]`; an unknown seam would be reported.
	require.Empty(t, depReg.Unknown([]string{"db"}), "requires:[db] must be a known seam")
	require.Equal(t, []string{"nope"}, depReg.Unknown([]string{"nope"}),
		"an unregistered seam is still reported (self-check the assertion can fail)")
}
