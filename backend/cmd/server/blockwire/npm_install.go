// npm_install.go — install a dsh block from the npm-backed marketplace.
//
// The npm fetch/verify lives in the marketplace domain (blockmarket.go); this op mounts what it
// returns. A package that is a dsh block (package.json declares dsh.bundle.patch) but carries no
// standmeet.block.yaml is a raw cordis/koishi plugin — mounting it needs the cordis→MCP wrapper
// (a separate north-star), so it is refused with that reason rather than silently failing.

package blockwire

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

type marketInstallArgs struct {
	ID      string `json:"id"`
	Version string `json:"version"`
}

func installMarketBlock(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		var in marketInstallArgs
		if uerr := json.Unmarshal(raw, &in); uerr != nil {
			return nil, fp.BadInput("invalid arguments: " + uerr.Error())
		}
		if rerr := fp.RequireArgs([2]string{"id", in.ID}); rerr != nil {
			return nil, rerr
		}
		if merr := doMarketInstall(ctx, d, &in); merr != nil {
			return nil, merr
		}
		return json.Marshal(okOut{OK: true})
	}
}

func doMarketInstall(ctx context.Context, d *deps.Runtime, in *marketInstallArgs) error {
	fb, err := d.BlockMarket.Fetch(ctx, in.ID, in.Version)
	if err != nil {
		// A bad id / version / unreachable package is a client-facing "wrong address", not a 500.
		return fp.NotFound("could not fetch marketplace package " + in.ID + ": " + err.Error())
	}
	if !fb.IsDshBlock {
		return fp.BadInput(in.ID + " is not a dsh block (no dsh.bundle.patch in its package.json)")
	}
	if fb.ManifestYAML == "" {
		return fp.BadInput(in.ID + " is a dsh block but carries no standmeet.block.yaml — a raw " +
			"cordis/koishi plugin needs the MCP wrapper, not yet supported")
	}
	m, perr := plugin.ParseManifest([]byte(fb.ManifestYAML))
	if perr != nil {
		return fp.OpErr("parse marketplace manifest", perr)
	}
	MountInstalledBlockAs(ctx, d, &m, registry.OriginMarketplace)
	return nil
}
