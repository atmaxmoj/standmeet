// embeds.go —— repository for embed widget configuration. An embed points to a
// code (embeds.code_id); the origin allow-list lives on the embed (embed plan
// 2026-09-01).

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/access/db"
	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// EmbedRepo —— repository for the embeds table.
type EmbedRepo struct {
	pool *pgstore.Pool
}

// NewEmbedRepo constructs an EmbedRepo.
func NewEmbedRepo(pool *pgstore.Pool) *EmbedRepo { return &EmbedRepo{pool: pool} }

func embedFromRow(e *db.Embed) entity.Embed {
	return entity.Embed{
		ID:             pgstore.FormatUUID(e.ID),
		OwnerID:        pgstore.FormatUUID(e.OwnerID),
		CodeID:         pgstore.FormatUUID(e.CodeID),
		Label:          e.Label,
		AllowedOrigins: DecodeStringJSON(e.AllowedOrigins),
		KeyID:          pgstore.FormatUUID(e.KeyID),
		PublicKey:      derefStr(e.PublicKey),
		CreatedAt:      e.CreatedAt.Time,
		UpdatedAt:      e.UpdatedAt.Time,
	}
}

func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// newEmbedKey —— one new embed Ed25519 key: kid (stored) + public-key PEM (stored)
// + private-key PEM (handed out once).
type newEmbedKey struct {
	pub  string
	priv string
	kid  pgtype.UUID
}

func mintEmbedKey() (newEmbedKey, error) {
	pems, err := cryptobox.GenerateEd25519PEMs()
	if err != nil {
		return newEmbedKey{}, fmt.Errorf("mint embed key: %w", err)
	}
	kid, perr := pgstore.ParseUUID(uuid.NewString())
	if perr != nil {
		return newEmbedKey{}, fmt.Errorf("parse key id: %w", perr)
	}
	return newEmbedKey{kid: kid, pub: pems.PublicPEM, priv: pems.PrivatePEM}, nil
}

// Create —— creates an embed (attached to a code), minting a per-embed Ed25519 key
// at the same time. The return value includes the private-key PEM, **only this
// once**: it goes into the widget's JS (not the code), the server keeps only the
// public key.
func (r *EmbedRepo) Create(
	ctx context.Context, ownerID, codeID, label string, origins []string,
) (entity.EmbedCreated, error) {
	ids, err := twoUUIDs(ownerID, codeID)
	if err != nil {
		return entity.EmbedCreated{}, err
	}
	blob, merr := marshalOrigins(origins)
	if merr != nil {
		return entity.EmbedCreated{}, merr
	}
	key, kerr := mintEmbedKey()
	if kerr != nil {
		return entity.EmbedCreated{}, kerr
	}
	row, qerr := db.New(r.pool).CreateEmbed(ctx, db.CreateEmbedParams{
		OwnerID: ids[0], CodeID: ids[1], Label: label, AllowedOrigins: blob,
		KeyID: key.kid, PublicKey: &key.pub,
	})
	if qerr != nil {
		return entity.EmbedCreated{}, createEmbedErr(qerr)
	}
	return entity.EmbedCreated{Embed: embedFromRow(&row), PrivateKey: key.priv}, nil
}

// AuthByKeyID —— looks up, from a JWT's kid, what signature verification needs:
// the public key + allow-list + the code it exposes. A kid that fails to parse /
// doesn't exist → ErrEmbedTokenInvalid (doesn't leak which one, just 401s).
func (r *EmbedRepo) AuthByKeyID(ctx context.Context, keyID string) (entity.EmbedAuth, error) {
	kid, err := pgstore.ParseUUID(keyID)
	if err != nil {
		return entity.EmbedAuth{}, entity.ErrEmbedTokenInvalid
	}
	row, qerr := db.New(r.pool).GetEmbedAuthByKeyID(ctx, kid)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.EmbedAuth{}, entity.ErrEmbedTokenInvalid
		}
		return entity.EmbedAuth{}, fmt.Errorf("embed auth by key id: %w", qerr)
	}
	return entity.EmbedAuth{
		PublicKey:      derefStr(row.PublicKey),
		Code:           row.Code,
		AllowedOrigins: DecodeStringJSON(row.AllowedOrigins),
	}, nil
}

// createEmbedErr —— maps write errors from creating an embed. code_id hitting the
// unique constraint → ErrCodeAlreadyEmbedded (a code already has an embed attached);
// everything else is wrapped as-is. Pulled out to keep Create's cyclomatic
// complexity low.
func createEmbedErr(err error) error {
	if name, hit := pgstore.UniqueViolation(err); hit && name == "embeds_code_uniq" {
		return entity.ErrCodeAlreadyEmbedded
	}
	return fmt.Errorf("create embed: %w", err)
}

// Get —— fetches by id (owner-scoped).
func (r *EmbedRepo) Get(ctx context.Context, ownerID, id string) (entity.Embed, error) {
	ids, err := twoUUIDs(id, ownerID)
	if err != nil {
		return entity.Embed{}, err
	}
	row, qerr := db.New(r.pool).GetEmbed(ctx, db.GetEmbedParams{ID: ids[0], OwnerID: ids[1]})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Embed{}, entity.ErrEmbedNotFound
		}
		return entity.Embed{}, fmt.Errorf("get embed: %w", qerr)
	}
	return embedFromRow(&row), nil
}

// ListByOwner —— all of an owner's embeds.
func (r *EmbedRepo) ListByOwner(ctx context.Context, ownerID string) ([]entity.Embed, error) {
	oid, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListEmbedsByOwner(ctx, oid)
	if qerr != nil {
		return nil, fmt.Errorf("list embeds: %w", qerr)
	}
	out := make([]entity.Embed, 0, len(rows))
	for i := range rows {
		out = append(out, embedFromRow(&rows[i]))
	}
	return out, nil
}

// Update —— changes label + allowed_origins.
func (r *EmbedRepo) Update(
	ctx context.Context, ownerID, id, label string, origins []string,
) (entity.Embed, error) {
	ids, err := twoUUIDs(id, ownerID)
	if err != nil {
		return entity.Embed{}, err
	}
	blob, merr := marshalOrigins(origins)
	if merr != nil {
		return entity.Embed{}, merr
	}
	row, qerr := db.New(r.pool).UpdateEmbed(ctx, db.UpdateEmbedParams{
		ID: ids[0], OwnerID: ids[1], Label: label, AllowedOrigins: blob,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return entity.Embed{}, entity.ErrEmbedNotFound
		}
		return entity.Embed{}, fmt.Errorf("update embed: %w", qerr)
	}
	return embedFromRow(&row), nil
}

// Delete —— deletes an embed (not the code it's attached to).
func (r *EmbedRepo) Delete(ctx context.Context, ownerID, id string) error {
	ids, err := twoUUIDs(id, ownerID)
	if err != nil {
		return err
	}
	derr := db.New(r.pool).DeleteEmbed(ctx, db.DeleteEmbedParams{ID: ids[0], OwnerID: ids[1]})
	if derr != nil {
		return fmt.Errorf("delete embed: %w", derr)
	}
	return nil
}

// twoUUIDs —— parses two uuids (return order matches argument order). Saves each
// method from writing this out itself.
func twoUUIDs(a, b string) ([2]pgtype.UUID, error) {
	var out [2]pgtype.UUID
	var err error
	if out[0], err = pgstore.ParseUUID(a); err != nil {
		return out, fmt.Errorf("parse uuid: %w", err)
	}
	if out[1], err = pgstore.ParseUUID(b); err != nil {
		return out, fmt.Errorf("parse uuid: %w", err)
	}
	return out, nil
}

// marshalOrigins —— []string → jsonb bytes; nil/empty both emit `[]` (the column
// is NOT NULL DEFAULT '[]').
func marshalOrigins(origins []string) ([]byte, error) {
	if origins == nil {
		origins = []string{}
	}
	b, err := json.Marshal(origins)
	if err != nil {
		return nil, fmt.Errorf("marshal allowed_origins: %w", err)
	}
	return b, nil
}
