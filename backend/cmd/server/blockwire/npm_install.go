// npm_install.go — install a dsh block from the npm-backed marketplace.
//
// The npm fetch/verify lives in the marketplace domain (blockmarket.go); this op stores and mounts
// what it returns. A package that is a dsh block (package.json declares dsh.bundle.patch) but
// carries no standmeet.block.yaml is a raw cordis/koishi plugin — mounting it needs the
// cordis→MCP wrapper (a separate north-star), so it is refused with that reason rather than
// silently failing.
//
// The package is stored like a pasted block, so it survives a restart, with the integrity the
// owner approved (roadmap 7.2.a). The same id with different contents is refused until the owner
// approves the new contents (accept_change).

package blockwire

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	market "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

type marketInstallArgs struct {
	ID           string `json:"id"`
	Version      string `json:"version"`
	AcceptChange bool   `json:"accept_change"`
}

func installMarketBlock(d *deps.Runtime) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in marketInstallArgs
		if uerr := json.Unmarshal(raw, &in); uerr != nil {
			return nil, fp.BadInput("invalid arguments: " + uerr.Error())
		}
		if rerr := fp.RequireArgs([2]string{"id", in.ID}); rerr != nil {
			return nil, rerr
		}
		if merr := doMarketInstall(ctx, d, ownerID, &in); merr != nil {
			return nil, merr
		}
		return json.Marshal(okOut{OK: true})
	}
}

// doMarketInstall — fetch and check, refuse unapproved new contents, then store and mount.
func doMarketInstall(
	ctx context.Context, d *deps.Runtime, ownerID string, in *marketInstallArgs,
) error {
	p, err := fetchMarketBlock(ctx, d, in)
	if err != nil {
		return err
	}
	if cerr := refuseUnapprovedChange(ctx, d, ownerID, p, in); cerr != nil {
		return cerr
	}
	return persistAndMount(ctx, d, ownerID, p)
}

// fetchMarketBlock — the package, checked against its published integrity, as an install.
func fetchMarketBlock(
	ctx context.Context, d *deps.Runtime, in *marketInstallArgs,
) (*parsedInstall, error) {
	fb, err := d.BlockMarket.Fetch(ctx, in.ID, in.Version)
	if errors.Is(err, market.ErrIntegrityMismatch) {
		return nil, fp.BadInput(in.ID + ": the downloaded package does not match the integrity " +
			"the registry published for it. Nothing was installed.")
	}
	if err != nil {
		// A bad id / version / unreachable package is a client-facing "wrong address", not a 500.
		return nil, fp.NotFound("could not fetch marketplace package " + in.ID + ": " + err.Error())
	}
	return marketInstallOf(in.ID, &fb)
}

// marketInstallOf — the fetched package as an install, or why it cannot be mounted.
func marketInstallOf(id string, fb *market.FetchedBlock) (*parsedInstall, error) {
	if !fb.IsDshBlock {
		return nil, fp.BadInput(id + " is not a dsh block " +
			"(no dsh.bundle.patch in its package.json)")
	}
	if fb.ManifestYAML == "" {
		return nil, fp.BadInput(id + " is a dsh block but carries no standmeet.block.yaml — a " +
			"raw cordis/koishi plugin needs the MCP wrapper, not yet supported")
	}
	m, perr := plugin.ParseManifest([]byte(fb.ManifestYAML))
	if perr != nil {
		return nil, fp.OpErr("parse marketplace manifest", perr)
	}
	return &parsedInstall{
		m: m, text: fb.ManifestYAML, origin: registry.OriginMarketplace, integrity: fb.Integrity,
	}, nil
}

// refuseUnapprovedChange — the owner approved one set of contents; different contents under the
// same block need their yes again.
func refuseUnapprovedChange(
	ctx context.Context, d *deps.Runtime, ownerID string, p *parsedInstall, in *marketInstallArgs,
) error {
	approved, err := d.Assembly.ApprovedIntegrity(ctx, ownerID, p.m.ID)
	if err != nil {
		return fp.OpErr("read approved integrity", err)
	}
	if in.AcceptChange || approved == "" || approved == p.integrity {
		return nil
	}
	return fp.Conflict(p.m.ID + ": the package's contents changed since you installed it. " +
		"Review the new version, then install again with accept_change: true.")
}

// originOr — a pasted block has no origin set: it is the owner's.
func originOr(o registry.Origin) registry.Origin {
	if o == "" {
		return registry.OriginOwner
	}
	return o
}
