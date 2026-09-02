// roles_seed.go — seeds the public prompt + public role. Called once when the owner
// claims (can also run once at server startup, since it's idempotent).
//
// Design: [[iam-role-pivot-plan]]. When the owner hasn't explicitly picked a role,
// access_code defaults to attaching the public role; public is configured with the
// three public corpus globs, no skill, no mcp, and attaches the public prompt. It can't
// be deleted (blocked at the repo layer + delete hidden in the UI).
//
// The copy matches the design mockup docs/design/project/admin-data.js PROMPTS[0] + ROLES[0].

package usecase

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// SeedPublicRole — idempotently upserts the public prompt + public role +
// role_corpus_uris's three public globs for one owner.
func SeedPublicRole(
	ctx context.Context,
	prompts *repo.PromptRepo, roles *access.RoleRepo,
	ownerID string,
) error {
	promptID, err := upsertPublicPrompt(ctx, prompts, ownerID)
	if err != nil {
		return err
	}
	role, err := upsertPublicRole(ctx, roles, ownerID, promptID)
	if err != nil {
		return err
	}
	if jerr := syncPublicRoleJoins(ctx, roles, role.ID()); jerr != nil {
		return jerr
	}
	if ierr := seedInvitedRole(ctx, roles, ownerID, promptID); ierr != nil {
		return ierr
	}
	// This used to also seed the `hiring` prompt + role the job loop needs — those don't
	// belong in this function. A plugin's own seeding belongs where it's assembled,
	// solely because that's where the seeder lives (the same lesson recorded in the
	// PeriodicWorker comment). It now lives in `internal/owner/jobs/jobs_seed.go`,
	// invoked by the host at the same moment via capabilities.OwnerSeeder.
	return nil
}

// seedInvitedRole — the builtin role attached to the codes the product issues on the
// owner's behalf (resume QR / approved requests).
//
// It shares the same persona as public (the same person's voice); the only difference
// is **whether it's invited**: this one carries a real allowlist and can read corpus
// the owner has curated, while public only reads what's published. Before the two were
// separated, a targeted invitation got the fallback profile meant for the uninvited —
// which, once public was narrowed, amounted to locking an invited person out.
func seedInvitedRole(
	ctx context.Context, roles *access.RoleRepo, ownerID, promptID string,
) error {
	role, err := roles.UpsertBuiltin(ctx, &access.UpsertBuiltinInput{
		OwnerID:     ownerID,
		Name:        access.InvitedRoleName,
		Description: access.InvitedRoleDescription,
		PromptID:    &promptID,
	})
	if err != nil {
		return fmt.Errorf("upsert invited role: %w", err)
	}
	if serr := roles.SetCorpusURIs(ctx, role.ID(), access.InvitedRoleCorpusURIs); serr != nil {
		return fmt.Errorf("set invited role corpus uris: %w", serr)
	}
	return nil
}

func upsertPublicPrompt(
	ctx context.Context, prompts *repo.PromptRepo, ownerID string,
) (string, error) {
	prompt, err := prompts.UpsertBuiltin(
		ctx, ownerID,
		entity.PublicPromptName, entity.PublicPromptDescription, entity.PublicPromptBody,
	)
	if err != nil {
		return "", fmt.Errorf("upsert public prompt: %w", err)
	}
	return prompt.ID(), nil
}

func upsertPublicRole(
	ctx context.Context, roles *access.RoleRepo, ownerID, promptID string,
) (access.Role, error) {
	role, err := roles.UpsertBuiltin(ctx, &access.UpsertBuiltinInput{
		OwnerID:     ownerID,
		Name:        access.PublicRoleName,
		Description: access.PublicRoleDescription,
		PromptID:    &promptID,
	})
	if err != nil {
		return access.Role{}, fmt.Errorf("upsert public role: %w", err)
	}
	return role, nil
}

// syncPublicRoleJoins — syncs role_corpus_uris + clears skills + clears mcp.
// public has no skill / no mcp, but clearing them explicitly keeps re-seed idempotent
// (if something else was seeded before and it's now reverted to the public shape, the
// join tables need a clean sweep).
//
// The corpus row is now **empty**: public reads whatever the owner has published,
// decided by each note's own `published` flag (`CorpusScope.PublishedOnly`). When an
// old instance upgrades, this re-seed removes the three
// `wiki://** output://** writing://**` entries — exactly what F-D-7 wants: that second
// list shouldn't exist.
func syncPublicRoleJoins(
	ctx context.Context, roles *access.RoleRepo, roleID string,
) error {
	if err := roles.SetCorpusURIs(ctx, roleID, access.PublicRoleCorpusURIs); err != nil {
		return fmt.Errorf("set public role corpus uris: %w", err)
	}
	if err := roles.SetSkills(ctx, roleID, []string{}); err != nil {
		return fmt.Errorf("clear public role skills: %w", err)
	}
	if err := roles.SetMCPServers(ctx, roleID, []string{}); err != nil {
		return fmt.Errorf("clear public role mcp servers: %w", err)
	}
	return nil
}
