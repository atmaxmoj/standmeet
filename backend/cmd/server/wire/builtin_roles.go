// builtin_roles.go — at boot, backfills builtin roles onto owners that **already exist**.
//
// The seed used to run only once, at claim time. After adding a new builtin (`invited`), that
// meant an already-deployed instance would be missing one row after upgrading — and the
// missing row is exactly the default profile used when issuing a code, so the owner would hit
// "invited role: not found" the first time they issued one. The feature works fine on a fresh
// instance and breaks on **every existing instance** — the hardest kind of breakage to notice.
//
// SeedPublicRole is an upsert throughout (prompt / role / role_corpus_uris are all
// idempotent), so running it on every startup is safe, and it incidentally clears the three
// leftover F-D-7 globs off an old instance's public role.

package wire

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// BuiltinRoles — reruns the builtin seed for this instance's owner. Best-effort: not yet
// claimed (no owner yet) simply skips; failure only logs, never blocks startup.
func BuiltinRoles(ctx context.Context, d *deps.Runtime) {
	soleOwner, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.OwnerRepo})
	if err != nil {
		return // not claimed yet -> no owner to seed; the claim path seeds on its own
	}
	if serr := owner.SeedPublicRole(ctx, d.PromptRepo, d.RoleRepo, soleOwner.ID); serr != nil {
		d.Log.Error("reseed builtin roles at boot", "owner_id", soleOwner.ID, "err", serr)
	}
	// Same story for plugins: after adding a new plugin builtin, **an already-deployed
	// instance** is missing one row after upgrading — and the missing row is exactly the
	// profile a code needs to attach at issue time. The feature works on a fresh instance
	// and breaks on every existing instance.
	if perr := d.PluginRegistry.SeedAllOwners(ctx, soleOwner.ID); perr != nil {
		d.Log.Error("reseed plugin builtins at boot", "owner_id", soleOwner.ID, "err", perr)
	}
}
