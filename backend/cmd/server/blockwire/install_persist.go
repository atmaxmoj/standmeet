// install_persist.go — the one path that stores an installed block and mounts it: a pasted
// manifest (blocks.install) and a marketplace package (blocks.marketplace_install) both end here.

package blockwire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/plugin/assembly"
)

// beforePersist — what must hold before the block is stored. A cyclic composition is refused:
// a block whose requires close a loop with the already-installed set has no load order. A package
// the block carries is installed now, so a package that cannot be installed leaves no block behind.
func beforePersist(ctx context.Context, d *deps.Runtime, ownerID string, p *parsedInstall) error {
	if cerr := refuseIfCycle(ctx, d, ownerID, &p.m); cerr != nil {
		return cerr
	}
	return wrapPackage(ctx, d, p.m.ID, p.m.Package)
}

// persistAndMount — persist before mounting, so a block that mounts today is still installed
// after a restart. The alternative is a block that works until the process dies, which is
// worse than one that never worked.
func persistAndMount(
	ctx context.Context, d *deps.Runtime, ownerID string, p *parsedInstall,
) error {
	if perr := beforePersist(ctx, d, ownerID, p); perr != nil {
		return perr
	}
	rec := assembly.InstalledBlock{
		BlockID: p.m.ID, Title: p.m.Title, Manifest: p.text, Origin: string(p.origin),
		Integrity: p.integrity,
	}
	serr := pgstore.InTx(ctx, d.Assembly.Pool(), func(tx pgstore.Tx) error {
		if err := d.Assembly.With(tx).Install(ctx, ownerID, &rec); err != nil {
			return err
		}
		return d.Recorder().With(tx).Record(ctx, ownerID, BlockInstalled, "block/"+p.m.ID,
			blockData(p.m.ID))
	})
	if serr != nil {
		return fp.OpErr("install block", serr)
	}
	// Re-installing is the owner's way of saying "I fixed it", so last time's
	// failure stops being the current state. A health indicator nobody can clear is
	// one nobody reads, and it would go red permanently on the first bad paste.
	if cerr := d.Assembly.ClearFailure(ctx, ownerID, p.m.ID); cerr != nil {
		d.Log.Warn("clear block failure on install", "id", p.m.ID, "err", cerr)
	}
	MountInstalledBlockAs(ctx, d, &p.m, originOr(p.origin))
	return nil
}
