// auth.go —— password_hash + owner profile queries needed by the login flow.
// These methods live in the same package as Repo, but Owner has no
// password_hash field, so a standalone function returns an (id, hash) tuple
// for the usecases layer to use.

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// Credentials is the minimal info login needs: the ID issues the session,
// the hash checks the password. Handle rides along too so LoginOutput
// doesn't need one more query (the frontend redirect uses it).
type Credentials struct {
	OwnerID      string
	PasswordHash string
	Handle       string
	// RecoveryHash —— hash of the #100 recovery phrase (empty = not
	// generated / already used). /recover checks against this column.
	RecoveryHash string
}

// GetCredentialsByEmail gets owner_id + password_hash; a missing email
// returns ErrOwnerNotFound (the usecase layer translates it to 401, to
// avoid revealing whether the user exists).
func (r *Repo) GetCredentialsByEmail(ctx context.Context, email string) (Credentials, error) {
	q := db.New(r.pool)
	row, err := q.GetOwnerByEmail(ctx, NormalizeEmail(email))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Credentials{}, entity.ErrOwnerNotFound
		}
		return Credentials{}, fmt.Errorf("get owner by email: %w", err)
	}
	return Credentials{
		OwnerID:      pgstore.FormatUUID(row.ID),
		PasswordHash: row.PasswordHash,
		Handle:       row.Handle,
		RecoveryHash: row.RecoveryHash,
	}, nil
}

// GetByHandle looks up the owner profile by handle (a URL segment).
// It checks owners.handle first; on a miss it falls through to
// handle_aliases — so an old handle still resolves after the owner
// renames. Returns ErrOwnerNotFound if neither hits.
func (r *Repo) GetByHandle(ctx context.Context, handle string) (entity.Owner, error) {
	q := db.New(r.pool)
	row, err := q.GetOwnerByHandle(ctx, handle)
	if err == nil {
		return toDomainOwner(&row), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return entity.Owner{}, fmt.Errorf("get owner by handle: %w", err)
	}
	return r.getByAlias(ctx, handle)
}

func (r *Repo) getByAlias(ctx context.Context, handle string) (entity.Owner, error) {
	q := db.New(r.pool)
	row, err := q.GetOwnerByHandleAlias(ctx, handle)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Owner{}, entity.ErrOwnerNotFound
		}
		return entity.Owner{}, fmt.Errorf("get owner by alias: %w", err)
	}
	return aliasRowToDomainOwner(&row), nil
}

// aliasRowToDomainOwner —— maps the owner subset used by the alias JOIN
// (no password_hash / custom_domain) to Owner identity. Settings are not
// extracted on this path — the public /<handle> page has no use for
// BYOAI / AI settings.
func aliasRowToDomainOwner(o *db.GetOwnerByHandleAliasRow) entity.Owner {
	return entity.Owner{
		ID:        pgstore.FormatUUID(o.ID),
		Email:     o.Email,
		Handle:    o.Handle,
		FullName:  o.FullName,
		Location:  o.Location,
		CreatedAt: o.CreatedAt.Time,
	}
}

// OwnerExists —— a lightweight "is this ownerID in the table right now"
// check (used for FK-error / auth debugging). Doesn't raise
// ErrOwnerNotFound, returns a bool and lets the caller log it themselves.
func (r *Repo) OwnerExists(ctx context.Context, id string) (bool, error) {
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return false, fmt.Errorf("parse owner id: %w", perr)
	}
	var exists bool
	row := r.pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM owners WHERE id = $1)`, pgID)
	if serr := row.Scan(&exists); serr != nil {
		return false, fmt.Errorf("scan owner exists: %w", serr)
	}
	return exists, nil
}

// PublicURL —— owner's public base URL (the narrow read used by a connector
// to build its oauth redirect).
func (r *Repo) PublicURL(ctx context.Context, ownerID string) (string, error) {
	o, err := r.GetByID(ctx, ownerID)
	if err != nil {
		return "", err
	}
	return o.PublicURL, nil
}

// GetByID gets the owner's public profile, used by /api/admin/me.
func (r *Repo) GetByID(ctx context.Context, id string) (entity.Owner, error) {
	q := db.New(r.pool)
	pgID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf("parse owner id: %w", perr)
	}
	row, err := q.GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.Owner{}, entity.ErrOwnerNotFound
		}
		return entity.Owner{}, fmt.Errorf("get owner by id: %w", err)
	}
	return toDomainOwner(&row), nil
}
