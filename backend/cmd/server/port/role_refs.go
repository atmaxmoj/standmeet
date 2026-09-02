// role_refs.go — composition-root adapter: narrows owner/marketplace repos' GetByID,
// by kind, into access.RefValidator (existence checking). Writing a role only needs
// "does this reference exist", not the entity — this adapter layer lets access avoid
// both holding a typed surface per reference kind and reverse-depending on
// owner/marketplace.
//
// A "not found" gets translated into access's own sentinel: the caller (access's role
// ops) can then phrase it in plain language without needing to know owner's /
// marketplace's error names — knowing them would be a reverse dependency.

package port

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// RoleRefValidator — existence checking for role references: checks prompt / skill /
// mcp server each by their own kind.
type RoleRefValidator struct {
	prompts *owner.PromptRepo
	skills  *marketplace.SkillRepo
	servers *marketplace.MCPServerRepo
}

// NewRoleRefValidator — constructor. Writing a role only needs "does this reference
// exist", not the entity.
func NewRoleRefValidator(d *deps.Runtime) RoleRefValidator {
	return RoleRefValidator{
		prompts: d.PromptRepo, skills: d.SkillRepo, servers: d.MCPServerRepo,
	}
}

// RefExists — does this id exist under this kind. Returns only existence, never
// the entity.
func (v RoleRefValidator) RefExists(ctx context.Context, ownerID, kind, id string) error {
	byKind := map[string]func(context.Context, string, string) error{
		access.RefPrompt:    v.promptExists,
		access.RefSkill:     v.skillExists,
		access.RefMCPServer: v.serverExists,
	}
	probe, ok := byKind[kind]
	if !ok {
		return fmt.Errorf("unknown role ref kind %q", kind)
	}
	return probe(ctx, ownerID, id)
}

func (v RoleRefValidator) promptExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.prompts.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("%w (%s): %w", access.ErrRefPromptNotFound, id, err)
	}
	return nil
}

func (v RoleRefValidator) skillExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.skills.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("%w (%s): %w", access.ErrRefSkillNotFound, id, err)
	}
	return nil
}

func (v RoleRefValidator) serverExists(ctx context.Context, ownerID, id string) error {
	if _, err := v.servers.GetByID(ctx, ownerID, id); err != nil {
		return fmt.Errorf("%w (%s): %w", access.ErrRefMCPServerNotFound, id, err)
	}
	return nil
}
