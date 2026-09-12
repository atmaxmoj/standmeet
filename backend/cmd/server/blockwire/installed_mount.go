// installed_mount.go — a block the owner installed becomes a fiber, at runtime.
//
// The single claim `tests.md` §3 calls "the acceptance test for the whole design" is
// that adding a block costs no code. That is only true if the owner's paste reaches the
// same registry the built-ins are in, through the same path, with no restart — otherwise
// "install" means "install, then ask someone to redeploy".
//
// Two entry points and one function underneath, deliberately:
//
//	MountInstalledBlock   the owner just pasted one
//	RestoreInstalledBlocks  the process just started and the volume remembers
//
// If those were two code paths, a block would be able to behave differently on the day
// it was installed than on every day after — the class of bug nobody reproduces because
// reproducing it takes a restart.

package blockwire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	"github.com/atmaxmoj/standmeet/internal/plugin"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// MountInstalledBlock — register one owner-installed block into the live registry.
//
// origin=owner, which is what makes it deletable in the panel: a built-in has no meaning
// apart from the image and cannot be removed, an owner's can. A duplicate id is refused
// rather than shadowing — first-wins is the registry's rule, and a block that silently
// replaced a built-in would be a way to redefine `corpus.retrieval` by naming a file.
func MountInstalledBlock(ctx context.Context, d *deps.Runtime, m *plugin.Manifest) {
	// Storage first: a block that declares settings needs somewhere to keep them before
	// anything can read them, and the panel reads them as soon as the row appears.
	ProvisionBlockStorage(ctx, d, m)
	ms := []plugin.Manifest{*m}
	noteBlock(ms)
	// The dial-error hook records WHY a block vanished, on its own detached context. It has
	// to be detached: the hook fires while a session is being assembled, and inheriting that
	// context would cancel the record at exactly the moment it matters. See
	// recordBlockFailure.
	dupes := mount.RegisterDiscoveredPlugins( //nolint:contextcheck // detached on purpose
		d.AgentSkills, ms, registry.OriginOwner, blockDialErrLog(d),
	)
	for _, id := range dupes {
		d.Log.Warn("installed block not mounted (id already registered)", "id", id)
	}
}

// RestoreInstalledBlocks — mount everything this instance's owners installed.
//
// Best-effort and non-fatal: a stored manifest that no longer parses (the owner
// downgraded, or a version gate tightened) must not stop the instance from coming up.
// It is logged with its id, because a block that is quietly absent is exactly the
// failure the third face of `block-model.md` exists to prevent.
func RestoreInstalledBlocks(ctx context.Context, d *deps.Runtime, ownerID string) {
	if d.Assembly == nil || ownerID == "" {
		return
	}
	rows, err := d.Assembly.ListInstalled(ctx, ownerID)
	if err != nil {
		d.Log.Error("restore installed blocks", "err", err)
		return
	}
	for i := range rows {
		remountInstalled(ctx, d, rows[i].BlockID, rows[i].Manifest)
	}
}

// remountInstalled — re-read one stored manifest and mount it, or say why it no longer works.
//
// A manifest that stopped parsing is logged and skipped rather than aborting the loop: one
// block the owner pasted badly must not take every other installed block down with it at boot.
func remountInstalled(ctx context.Context, d *deps.Runtime, blockID, text string) {
	m, perr := plugin.ParseManifest([]byte(text))
	if perr != nil {
		d.Log.Error("installed block no longer parses", "id", blockID, "err", perr)
		return
	}
	MountInstalledBlock(ctx, d, &m)
}
