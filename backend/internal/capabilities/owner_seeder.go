// owner_seeder.go — the hook a plugin uses to declare "what I need to exist under this
// owner".
//
// Kept in its own file instead of crowding into plugin.go: that file already sits at revive's
// max-public-structs limit, and this hook is a separate concern anyway.

package capabilities

import (
	"context"
	"fmt"
)

// OwnerSeeder — optional hook: the plugin declares the builtins (role / prompt / …) it needs
// to exist under a given owner.
//
// **Must be idempotent**: it runs once at claim time, then again on every startup (the same
// cadence as SeedPublicRole), so it can only ever be an upsert.
//
// Why this belongs to the plugin and not the core's own seed: `hiring` is a job-loop concept,
// not a core-level access layer. Writing it into access/entity would make the core aware of a
// plugin's vocabulary, and only the plugin actually knows that glob (where the recruiter's
// CV should be read from).
type OwnerSeeder interface {
	SeedOwner(ctx context.Context, ownerID string) error
}

// SeedAllOwners — has every plugin seed its own builtins under this owner.
//
// This is the same lesson as PeriodicWorker, hit a second time: **this hook didn't exist
// before, so the `hiring` role and prompt the jobs plugin needed ended up landing in the
// core's roles_seed — a plugin's stuff landing wherever the wiring happened to sit, only
// because the seeder was there.** The core then ended up aware of a plugin's vocabulary
// ("hiring"), and since `check-core-agnostic`'s CORE_DIRS doesn't cover access/entity, that
// lock is structurally blind to this kind of leak.
//
// The host is only responsible for "when to seed" (once at claim, then once per startup);
// what gets seeded, and in what shape, belongs to the plugin.
func (r *Registry) SeedAllOwners(ctx context.Context, ownerID string) error {
	for _, p := range r.plugins {
		os, ok := p.(OwnerSeeder)
		if !ok {
			continue
		}
		if err := os.SeedOwner(ctx, ownerID); err != nil {
			return fmt.Errorf("seed owner for plugin %s: %w", p.Name(), err)
		}
	}
	return nil
}
