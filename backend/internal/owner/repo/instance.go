// InstanceRepo + the atomic claim flow.
//
// Claim combines an instance state change (is_claimed=true) with owner
// creation, and needs one DB transaction to guarantee atomicity: either
// both sides succeed, or both roll back. This cross-aggregate transaction
// is written directly at the infra layer (avoiding a UnitOfWork
// abstraction); usecase just calls it.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// InstanceRepo provides reads of the single instance_settings row + writes
// of the setup token.
type InstanceRepo struct {
	pool *pgstore.Pool
}

// NewInstanceRepo constructs an InstanceRepo.
func NewInstanceRepo(pool *pgstore.Pool) *InstanceRepo {
	return &InstanceRepo{pool: pool}
}

// Get reads the single instance_settings row.
func (r *InstanceRepo) Get(ctx context.Context) (entity.InstanceSettings, error) {
	q := db.New(r.pool)
	row, err := q.GetInstanceSettings(ctx)
	if err != nil {
		return entity.InstanceSettings{}, fmt.Errorf("get instance settings: %w", err)
	}
	return entity.InstanceSettings{
		IsClaimed:         row.IsClaimed,
		MultiTenant:       row.MultiTenant,
		DeployedAt:        row.DeployedAt.Time,
		HasSetupTokenHash: row.SetupTokenHash != nil && *row.SetupTokenHash != "",
		SetupTokenHash:    derefOrEmpty(row.SetupTokenHash),
	}, nil
}

// derefOrEmpty —— reads a NULL text column as an empty string.
func derefOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// IsDomainAllowed —— used by /internal/tls-ask: whether domain is on the
// allowed_domains allowlist. Caddy on-demand TLS uses this to decide
// whether to sign it a certificate.
func (r *InstanceRepo) IsDomainAllowed(ctx context.Context, dom string) (bool, error) {
	list, err := r.loadAllowedDomains(ctx)
	if err != nil {
		return false, err
	}
	return slices.Contains(list, dom), nil
}

// AddAllowedDomain —— adds domain to the allowlist (deduped). Called by
// admin / setup.
func (r *InstanceRepo) AddAllowedDomain(ctx context.Context, dom string) error {
	list, err := r.loadAllowedDomains(ctx)
	if err != nil {
		return err
	}
	if slices.Contains(list, dom) {
		return nil
	}
	return r.writeAllowedDomains(ctx, append(list, dom))
}

// RemoveAllowedDomain —— removes domain from the allowlist; not an error
// if it's already absent (idempotent).
func (r *InstanceRepo) RemoveAllowedDomain(ctx context.Context, dom string) error {
	list, err := r.loadAllowedDomains(ctx)
	if err != nil {
		return err
	}
	filtered := make([]string, 0, len(list))
	for _, d := range list {
		if d != dom {
			filtered = append(filtered, d)
		}
	}
	if len(filtered) == len(list) {
		return nil
	}
	return r.writeAllowedDomains(ctx, filtered)
}

// ListAllowedDomains —— returns the current allowlist (an empty slice on
// empty jsonb).
func (r *InstanceRepo) ListAllowedDomains(ctx context.Context) ([]string, error) {
	list, err := r.loadAllowedDomains(ctx)
	if err != nil {
		return nil, err
	}
	if list == nil {
		return []string{}, nil
	}
	return list, nil
}

// SetSetupTokenHash stores the sha256 hash of the setup token generated at
// startup into instance_settings.setup_token_hash. An already-claimed
// instance shouldn't call this again (calling it just re-updates the
// column, with no semantic effect).
func (r *InstanceRepo) SetSetupTokenHash(ctx context.Context, hash string) error {
	q := db.New(r.pool)
	if err := q.SetSetupTokenHash(ctx, &hash); err != nil {
		return fmt.Errorf("set setup token hash: %w", err)
	}
	return nil
}

// ClaimAndCreateOwner does the following in a single transaction:
//  1. TryClaimInstance(tokenHash) —— succeeds if and only if is_claimed=false
//     and setup_token_hash matches; an UPDATE ... RETURNING with 0 rows
//     counts as failure.
//  2. CreateOwner —— inserts the first owner row.
//
// Returns a domain sentinel error on failure; returns the newly created
// Owner on success.
func (r *InstanceRepo) ClaimAndCreateOwner(
	ctx context.Context,
	tokenHash string,
	input *entity.CreateOwnerInput,
) (entity.Owner, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return entity.Owner{}, fmt.Errorf("begin tx: %w", err)
	}
	ownerRow, txErr := claimTx(ctx, tx, tokenHash, input)
	if txErr != nil {
		if rerr := tx.Rollback(ctx); rerr != nil {
			return entity.Owner{}, errors.Join(txErr, fmt.Errorf("rollback: %w", rerr))
		}
		return entity.Owner{}, txErr
	}
	if cerr := tx.Commit(ctx); cerr != nil {
		return entity.Owner{}, fmt.Errorf("commit claim: %w", cerr)
	}
	return ownerRow, nil
}

// claimTx is the inner body of ClaimAndCreateOwner.
func claimTx(
	ctx context.Context,
	tx pgx.Tx,
	tokenHash string,
	input *entity.CreateOwnerInput,
) (entity.Owner, error) {
	q := db.New(tx)

	if _, err := q.TryClaimInstance(ctx, &tokenHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Owner{}, entity.ErrInvalidSetupToken
		}
		return entity.Owner{}, fmt.Errorf("try claim: %w", err)
	}

	row, err := q.CreateOwner(ctx, db.CreateOwnerParams{
		Email:        NormalizeEmail(input.Email),
		PasswordHash: input.PasswordHash,
		Handle:       input.Handle,
		FullName:     input.FullName,
		PublicUrl:    input.PublicURL,
	})
	if err != nil {
		return entity.Owner{}, translateCreateOwnerErr(err)
	}
	return toDomainOwner(&row), nil
}

func translateCreateOwnerErr(err error) error {
	constraint, isUnique := pgstore.UniqueViolation(err)
	if !isUnique {
		return fmt.Errorf("create owner: %w", err)
	}
	switch constraint {
	case "owners_email_key":
		return entity.ErrEmailTaken
	case "owners_handle_key":
		return entity.ErrHandleTaken
	default:
		return fmt.Errorf("create owner unique violation %s: %w", constraint, err)
	}
}

// loadAllowedDomains / writeAllowedDomains —— jsonb encode/decode helpers
// for allowed_domains. Placed at the end of the file to satisfy funcorder
// (unexported after exported).

func (r *InstanceRepo) loadAllowedDomains(ctx context.Context) ([]string, error) {
	row, err := db.New(r.pool).GetInstanceSettings(ctx)
	if err != nil {
		return []string{}, fmt.Errorf("get instance settings: %w", err)
	}
	if len(row.AllowedDomains) == 0 {
		return []string{}, nil
	}
	var list []string
	if uerr := json.Unmarshal(row.AllowedDomains, &list); uerr != nil {
		return []string{}, fmt.Errorf("unmarshal allowed domains: %w", uerr)
	}
	return list, nil
}

func (r *InstanceRepo) writeAllowedDomains(ctx context.Context, list []string) error {
	encoded, merr := json.Marshal(list)
	if merr != nil {
		return fmt.Errorf("marshal allowed domains: %w", merr)
	}
	q := db.New(r.pool)
	if eerr := q.SetAllowedDomains(ctx, encoded); eerr != nil {
		return fmt.Errorf("update allowed domains: %w", eerr)
	}
	return nil
}
