// skillhandover.go —— the Skills subsystem's service, built over its own Postgres store. Used in
// the skills.* handover ops, the claim seed, and the boot seed, all over the same tables.

package port

import (
	"context"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/skills"
	"github.com/atmaxmoj/standmeet/internal/owner/skills/skillpg"
)

// SkillHandover —— the Skills subsystem service over the agent_skills tables.
func SkillHandover(d *deps.Runtime) *owner.SkillService {
	return skills.NewService(skillpg.New(d.DB), nil)
}

// SeedBundledSkills —— ensure the bundled skills (the interview loop) exist for the sole owner at
// boot. Claim seeds a fresh instance; this covers an already-claimed instance that gains the
// feature through an upgrade (SeedBundled is idempotent). Silent on an unclaimed instance.
func SeedBundledSkills(ctx context.Context, d *deps.Runtime) {
	ownerID, err := NewSoleOwnerLookup(d).SoleOwnerID(ctx)
	if err != nil || ownerID == "" {
		return
	}
	if serr := skills.SeedBundled(ctx, SkillHandover(d), ownerID); serr != nil {
		d.Log.Error("seed bundled skills", "owner_id", ownerID, "err", serr)
	}
}
