// providers.go —— reads and writes owner_providers: the owner's provider
// list.
//
// Went from one → many. Originally four columns on the owner row
// (ai_provider / ai_provider_key_enc / ai_endpoint / ai_model), now it's
// one table with one row flagged is_default. A code or a role can each
// point to a specific entry; the resolution order is
// `byoai > code > role > default` — that ordering lives in usecase, this
// layer only fetches.
//
// **key_enc stays sealed when it leaves this layer.** Unsealing only
// happens at the assembly side (cmd/server/unseal.go); that's the §1.5
// invariant, watched over by check-core-seals-only.sh.

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// ProviderRow —— one entry in the list. KeyEnc is ciphertext (this domain
// never unseals it).
//
// GasTokens is **how much was added**, not how much remains; GasFilledAt
// is the moment of that fill, i.e. the billing-period start. How much
// remains doesn't exist at this layer — it's derived by summing usage
// (usecase.ProviderRemaining).
type ProviderRow struct {
	GasTokens     *int64
	GasFilledAt   *time.Time
	OwnerID       string
	ID            string
	Label         string
	Provider      string
	Endpoint      string
	Model         string
	KeyEnc        []byte
	IsDefault     bool
	KeyConfigured bool
}

// CreateProviderInput —— creates one entry. Key is ciphertext **already
// sealed**; plaintext never enters this layer.
type CreateProviderInput struct {
	OwnerID   string
	Label     string
	Provider  string
	Endpoint  string
	Model     string
	KeyEnc    []byte
	IsDefault bool
}

// providerKey —— the two uuids needed to locate one provider entry.
type providerKey struct {
	owner pgtype.UUID
	id    pgtype.UUID
}

// parseProviderKey —— parses both ids together. A provider id that fails
// to parse is **not** treated as a format error but as "no such entry in
// the list" (the caller's id could have come from anywhere) →
// ErrProviderNotFound, the same answer as a genuine lookup miss.
func parseProviderKey(ownerID, id string) (providerKey, error) {
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return providerKey{}, fmt.Errorf(parseOwnerIDErrFmt, oerr)
	}
	idUUID, ierr := pgstore.ParseUUID(id)
	if ierr != nil {
		return providerKey{}, entity.ErrProviderNotFound
	}
	return providerKey{owner: ownerUUID, id: idUUID}, nil
}

func toProviderRow(p *db.OwnerProvider) ProviderRow {
	return ProviderRow{
		ID: pgstore.FormatUUID(p.ID), OwnerID: pgstore.FormatUUID(p.OwnerID),
		Label: p.Label, Provider: p.Provider,
		Endpoint: p.Endpoint, Model: p.Model, KeyEnc: p.KeyEnc,
		IsDefault: p.IsDefault, KeyConfigured: len(p.KeyEnc) > 0,
		GasTokens: p.GasTokens, GasFilledAt: pgstore.OptTime(p.GasFilledAt),
	}
}

// CreateProviderPlainInput —— input for creating an entry with a
// **plaintext** key. Sealing happens at this layer (seal only, never
// unseal, §1.5); the layer above never gets the ciphertext and doesn't
// need to know encryption is happening at all.
type CreateProviderPlainInput struct {
	OwnerID      string
	Label        string
	Provider     string
	Endpoint     string
	Model        string
	KeyPlaintext string
	IsDefault    bool
}

// CreateProviderPlain —— accepts a plaintext key, seals it, then writes the
// row. An empty key means this entry has no key configured yet (valid:
// an owner can create the entry first and fill in the key later).
func (r *Repo) CreateProviderPlain(
	ctx context.Context, in *CreateProviderPlainInput,
) (ProviderRow, error) {
	enc, eerr := sealProviderKey(in.OwnerID, &in.KeyPlaintext)
	if eerr != nil {
		return ProviderRow{}, eerr
	}
	return r.CreateProvider(ctx, &CreateProviderInput{
		OwnerID: in.OwnerID, Label: in.Label, Provider: in.Provider,
		Endpoint: in.Endpoint, Model: in.Model, KeyEnc: enc, IsDefault: in.IsDefault,
	})
}

// CreateProvider —— creates a new entry. is_default is decided by the
// caller; to set it default the caller must call ClearDefault first
// (both steps live in usecase — getting the order wrong collides with
// that partial unique index, which is exactly why it exists).
func (r *Repo) CreateProvider(
	ctx context.Context, in *CreateProviderInput,
) (ProviderRow, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return ProviderRow{}, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	row, qerr := db.New(r.pool).CreateOwnerProvider(ctx, db.CreateOwnerProviderParams{
		OwnerID: ownerUUID, Label: in.Label, Provider: in.Provider,
		KeyEnc: in.KeyEnc, Endpoint: in.Endpoint, Model: in.Model,
		IsDefault: in.IsDefault,
	})
	if qerr != nil {
		return ProviderRow{}, fmt.Errorf("create owner provider: %w", qerr)
	}
	return toProviderRow(&row), nil
}

// ListProviders —— the whole list, with the default entry first.
func (r *Repo) ListProviders(ctx context.Context, ownerID string) ([]ProviderRow, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	rows, qerr := db.New(r.pool).ListOwnerProviders(ctx, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list owner providers: %w", qerr)
	}
	out := make([]ProviderRow, 0, len(rows))
	for i := range rows {
		out = append(out, toProviderRow(&rows[i]))
	}
	return out, nil
}

// GetProvider —— one entry (owner-scoped). Not found → ErrProviderNotFound.
func (r *Repo) GetProvider(
	ctx context.Context, ownerID, id string,
) (ProviderRow, error) {
	key, perr := parseProviderKey(ownerID, id)
	if perr != nil {
		return ProviderRow{}, perr
	}
	row, qerr := db.New(r.pool).GetOwnerProvider(ctx,
		db.GetOwnerProviderParams{ID: key.id, OwnerID: key.owner})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return ProviderRow{}, entity.ErrProviderNotFound
		}
		return ProviderRow{}, fmt.Errorf("get owner provider: %w", qerr)
	}
	return toProviderRow(&row), nil
}

// DefaultProvider —— the default entry. An owner with no default →
// ErrProviderNotFound (that's the floor of the resolution chain: there's
// nowhere further to fall back to).
func (r *Repo) DefaultProvider(ctx context.Context, ownerID string) (ProviderRow, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return ProviderRow{}, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	row, qerr := db.New(r.pool).GetDefaultOwnerProvider(ctx, ownerUUID)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return ProviderRow{}, entity.ErrProviderNotFound
		}
		return ProviderRow{}, fmt.Errorf("get default provider: %w", qerr)
	}
	return toProviderRow(&row), nil
}

// UpdateProviderInput —— a partial update: nil means leave that field
// alone. SetGas is the third state of a tri-state (SetGas=true +
// GasTokens=nil is what actually means "stop metering").
type UpdateProviderInput struct {
	Label     *string
	Provider  *string
	Endpoint  *string
	Model     *string
	GasTokens *int64
	OwnerID   string
	ID        string
	SetGas    bool
}

// UpdateProvider —— a partial update. Not found → ErrProviderNotFound
// (the :one no-rows case).
func (r *Repo) UpdateProvider(
	ctx context.Context, in *UpdateProviderInput,
) (ProviderRow, error) {
	params, perr := buildUpdateProviderParams(in)
	if perr != nil {
		return ProviderRow{}, perr
	}
	row, qerr := db.New(r.pool).UpdateOwnerProvider(ctx, params)
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return ProviderRow{}, entity.ErrProviderNotFound
		}
		return ProviderRow{}, fmt.Errorf("update owner provider: %w", qerr)
	}
	return toProviderRow(&row), nil
}

func buildUpdateProviderParams(
	in *UpdateProviderInput,
) (db.UpdateOwnerProviderParams, error) {
	ownerUUID, oerr := pgstore.ParseUUID(in.OwnerID)
	if oerr != nil {
		return db.UpdateOwnerProviderParams{}, fmt.Errorf(parseOwnerIDErrFmt, oerr)
	}
	idUUID, ierr := pgstore.ParseUUID(in.ID)
	if ierr != nil {
		return db.UpdateOwnerProviderParams{}, entity.ErrProviderNotFound
	}
	return db.UpdateOwnerProviderParams{
		ID: idUUID, OwnerID: ownerUUID,
		Label: in.Label, Provider: in.Provider,
		Endpoint: in.Endpoint, Model: in.Model,
		SetGas: in.SetGas, GasTokens: in.GasTokens,
	}, nil
}

// SetProviderKey —— swaps in a new key (already-sealed ciphertext). 0 rows
// means no such entry → ErrProviderNotFound. Saying "key stored" to a row
// that doesn't exist is the same kind of lie as revoking something that
// was never there.
func (r *Repo) SetProviderKey(ctx context.Context, ownerID, id string, keyEnc []byte) error {
	key, perr := parseProviderKey(ownerID, id)
	if perr != nil {
		return perr
	}
	rows, qerr := db.New(r.pool).SetOwnerProviderKey(ctx, db.SetOwnerProviderKeyParams{
		ID: key.id, OwnerID: key.owner, KeyEnc: keyEnc,
	})
	if qerr != nil {
		return fmt.Errorf("set provider key: %w", qerr)
	}
	if rows == 0 {
		return entity.ErrProviderNotFound
	}
	return nil
}

// SetDefaultProvider —— moves default to this entry: clear all first, then
// set. The partial unique index between the two steps guarantees there's
// never two defaults; if the set step hits 0 rows, the target doesn't
// exist, and that would leave this owner with **no default at all** —
// the entire fallback story stands on there being one, so this must be
// reported.
func (r *Repo) SetDefaultProvider(ctx context.Context, ownerID, id string) error {
	key, perr := parseProviderKey(ownerID, id)
	if perr != nil {
		return perr
	}
	q := db.New(r.pool)
	if cerr := q.ClearDefaultOwnerProvider(ctx, key.owner); cerr != nil {
		return fmt.Errorf("clear default provider: %w", cerr)
	}
	rows, serr := q.SetDefaultOwnerProvider(ctx,
		db.SetDefaultOwnerProviderParams{ID: key.id, OwnerID: key.owner})
	if serr != nil {
		return fmt.Errorf("set default provider: %w", serr)
	}
	if rows == 0 {
		return entity.ErrProviderNotFound
	}
	return nil
}

// DeleteProvider —— deletes one entry. The SQL itself carries
// `AND NOT is_default`, so 0 rows has two possible causes: no such entry,
// or it was the default one. The caller (usecase) reads first to tell
// which — this layer only reports "delete didn't happen".
func (r *Repo) DeleteProvider(ctx context.Context, ownerID, id string) error {
	key, perr := parseProviderKey(ownerID, id)
	if perr != nil {
		return perr
	}
	rows, qerr := db.New(r.pool).DeleteOwnerProvider(ctx,
		db.DeleteOwnerProviderParams{ID: key.id, OwnerID: key.owner})
	if qerr != nil {
		return fmt.Errorf("delete owner provider: %w", qerr)
	}
	if rows == 0 {
		return entity.ErrProviderNotFound
	}
	return nil
}
