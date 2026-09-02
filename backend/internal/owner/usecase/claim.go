// claim.go — orchestrates first-run "claim this instance": creates the owner + password +
// setup-token validation + seeds the public role/prompt. Spans owner/access/marketplace/
// session; this is the owner domain's onboarding usecase.

package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"slices"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// ClaimDeps bundles the dependencies ClaimInstance needs, to avoid an overlong param list.
type ClaimDeps struct {
	Instance *repo.InstanceRepo
	Skills   *marketplace.SkillRepo
	Prompts  *repo.PromptRepo
	Roles    *access.RoleRepo
}

// ClaimInput is the input to ClaimInstance.
type ClaimInput struct {
	Token     string
	Email     string
	Password  string
	Handle    string
	FullName  string
	PublicURL string // Full URL, incl. scheme + host (+ port). Used by SEO canonical / QR too.
}

// ClaimInstance runs the first-time claim flow:
//  1. Validate input's required fields.
//  2. Hash the plaintext setup token + run password through Argon2id.
//  3. Atomically claim instance + create owner inside a transaction.
//
// The returned Owner has no password; the password was hashed and written to the DB
// from input. Takes *ClaimInput by pointer to avoid gocritic hugeParam.
func ClaimInstance(ctx context.Context, deps ClaimDeps, in *ClaimInput) (entity.Owner, error) {
	if err := validateClaimInput(in); err != nil {
		return entity.Owner{}, err
	}

	passwordHash, err := session.HashPassword(in.Password)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("hash password: %w", err)
	}

	tokenHash := session.HashSetupToken(in.Token)

	created, err := deps.Instance.ClaimAndCreateOwner(ctx, tokenHash, &entity.CreateOwnerInput{
		Email:        in.Email,
		PasswordHash: passwordHash,
		Handle:       in.Handle,
		FullName:     in.FullName,
		PublicURL:    NormalizePublicURL(in.PublicURL),
	})
	if err != nil {
		return entity.Owner{}, fmt.Errorf("claim and create owner: %w", err)
	}
	// FK-violation debugging: log the owner ID created + the email/handle
	// it's bound to. Cross-reference with create-token-fk-diag logs to see
	// if subsequent token creates use the same owner_id.
	slog.Default().Info("claim succeeded",
		"owner_id", created.ID, "email", in.Email, "handle", in.Handle)
	seedClaimSkills(ctx, deps, created.ID)
	seedClaimPublicRole(ctx, deps, created.ID)
	return created, nil
}

// seedClaimSkills — after a successful claim, seed built-in skills; on failure, log +
// continue rather than blocking the claim (the owner can still log in).
func seedClaimSkills(ctx context.Context, deps ClaimDeps, ownerID string) {
	if deps.Skills == nil {
		return
	}
	if err := marketplace.SeedBuiltinSkills(ctx, deps.Skills, ownerID); err != nil {
		slog.Default().Error("seed builtin skills", "owner_id", ownerID, "err", err)
	}
}

// seedClaimPublicRole — after a successful claim, seeds the public prompt + public
// role; on failure, log + continue rather than blocking the claim. See [[iam-role-pivot-plan]].
func seedClaimPublicRole(ctx context.Context, deps ClaimDeps, ownerID string) {
	if deps.Prompts == nil || deps.Roles == nil {
		return
	}
	if err := SeedPublicRole(ctx, deps.Prompts, deps.Roles, ownerID); err != nil {
		slog.Default().Error("seed public role", "owner_id", ownerID, "err", err)
	}
}

// validateClaimInput uses slice + slices.Contains to keep cyclo <= 2.
func validateClaimInput(in *ClaimInput) error {
	fields := []string{in.Token, in.Email, in.Password, in.Handle, in.FullName, in.PublicURL}
	if slices.Contains(fields, "") {
		return apierr.ErrEmptyField
	}
	if !ValidPublicURL(in.PublicURL) {
		return ErrPublicURLInvalid
	}
	return nil
}

// ValidPublicURL — must start with http:// or https://, host must be non-empty. Full URL
// parsing lives in NormalizePublicURL; this only blocks the obviously wrong (empty scheme
// / a bare host).
