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

// manifestSetWith — the current set plus the new manifest, with a reinstall replacing its own prior
// manifest (so re-pasting a fixed manifest is judged on the new text).
func manifestSetWith(
	ctx context.Context, d *deps.Runtime, ownerID string, m *plugin.Manifest,
) []plugin.Manifest {
	set := currentManifestSet(ctx, d, ownerID)
	out := make([]plugin.Manifest, 0, len(set)+1)
	for i := range set {
		if set[i].ID == m.ID {
			continue // reinstall: the new manifest replaces the stored one
		}
		out = append(out, set[i])
	}
	return append(out, *m)
}

// currentManifestSet — builtins + this owner's installed blocks. A stored manifest that no longer
// parses is skipped, not fatal: one bad prior paste must not break the graph, and it contributes no
// edges anyway.
func currentManifestSet(ctx context.Context, d *deps.Runtime, ownerID string) []plugin.Manifest {
	out := append([]plugin.Manifest{}, BuiltinManifests()...)
	rows, err := d.Assembly.ListInstalled(ctx, ownerID)
	if err != nil {
		d.Log.Warn("manifest set: list installed failed; builtins only", "err", err)
	}
	for i := range rows {
		parsed, perr := plugin.ParseManifest([]byte(rows[i].Manifest))
		if perr != nil {
			continue
		}
		out = append(out, parsed)
	}
	return out
}
