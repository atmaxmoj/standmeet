// skillhandover.go —— the Skills subsystem's service, built over its own Postgres store. Used in
// two places (the skills.* handover ops and the claim seed), both over the same tables.

package port

import (
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/skills"
	"github.com/atmaxmoj/standmeet/internal/owner/skills/skillpg"
)

// SkillHandover —— the Skills subsystem service over the agent_skills tables.
func SkillHandover(d *deps.Runtime) *owner.SkillService {
	return skills.NewService(skillpg.New(d.DB), nil)
}
