// block_cycle_check.go — refuse an install that would make the block dependency graph cyclic.
//
// A block depends on another when it `requires` a seam that one `provides`. That graph must stay a
// DAG: a cycle has no load order that satisfies every block, so resolution refuses the install
// rather than persist a composition that can never mount (everything-is-a-block.md — "a cyclic
// composition is refused"). The check runs over the whole set (builtins + this owner's installed +
// the new one) because install does not otherwise validate requires; refusing at each install keeps
// the set acyclic, so a new cycle can only be the one the new block introduced.

package blockwire

import (
	"context"
	"strings"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin"
)

// refuseIfCycle — BadInput naming the cycle if installing m would create one; nil otherwise.
func refuseIfCycle(ctx context.Context, d *deps.Runtime, ownerID string, m *plugin.Manifest) error {
	if cyc := plugin.Cycle(manifestSetWith(ctx, d, ownerID, m)); len(cyc) > 0 {
		return fp.BadInput("this block would form a dependency cycle: " + strings.Join(cyc, " → "))
	}
	return nil
}

// manifestSetWith — builtins + this owner's installed blocks + the new one. A reinstall replaces
// its own prior manifest (so re-pasting a fixed manifest is judged on the new text). A stored
// manifest that no longer parses is skipped, not fatal: one bad prior paste must not block a new
// install, and it contributes no edges anyway.
func manifestSetWith(
	ctx context.Context, d *deps.Runtime, ownerID string, m *plugin.Manifest,
) []plugin.Manifest {
	out := append([]plugin.Manifest{}, BuiltinManifests()...)
	rows, err := d.Assembly.ListInstalled(ctx, ownerID)
	if err != nil {
		d.Log.Warn("cycle check: list installed failed; checking builtins + new only", "err", err)
	}
	for i := range rows {
		if rows[i].BlockID == m.ID {
			continue // reinstall: the new manifest replaces the stored one
		}
		parsed, perr := plugin.ParseManifest([]byte(rows[i].Manifest))
		if perr != nil {
			continue // a stored manifest that no longer parses contributes no edges
		}
		out = append(out, parsed)
	}
	return append(out, *m)
}
