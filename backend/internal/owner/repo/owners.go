// Repo wraps the sqlc-generated db.Queries.
// It maps pgtype.* to plain-Go Owner types, so the usecase / routes
// layers never need to know about pgtype.

package repo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/db"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// pgxErrNoRows —— helper: avoids importing pgx.ErrNoRows directly in
// multiple places, so grep has one consistent starting point.
func pgxErrNoRows() error { return pgx.ErrNoRows }

// parseOwnerIDErrFmt —— the literal "parse owner id" recurs multiple times
// in this file, so it's pulled into a constant.
const parseOwnerIDErrFmt = "parse owner id: %w"

// Repo provides owner CRUD (currently only Create and Count are used; more
// to come).
type Repo struct {
	pool *pgstore.Pool
}

// NewRepo constructs a Repo.
func NewRepo(pool *pgstore.Pool) *Repo {
	return &Repo{pool: pool}
}

// Count returns the row count of the owners table (used to determine
// "is there an owner yet").
func (r *Repo) Count(ctx context.Context) (int64, error) {
	q := db.New(r.pool)
	n, err := q.CountOwners(ctx)
	if err != nil {
		return 0, fmt.Errorf("count owners: %w", err)
	}
	return n, nil
}

// FirstHandle returns the earliest owner's handle; an empty table returns
// "" (not an error — the app root route uses this to decide whether to
// redirect the user to /setup).
func (r *Repo) FirstHandle(ctx context.Context) (string, error) {
	q := db.New(r.pool)
	handle, err := q.GetFirstOwnerHandle(ctx)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return "", nil
		}
		return "", fmt.Errorf("get first owner handle: %w", err)
	}
	return handle, nil
}

// pgUniqueViolation detects a pgx unique-constraint conflict, returning the
// constraint name + whether it hit. Lets the caller translate a DB-level
// error into a domain sentinel error.
// toDomainOwner maps sqlc's generated db.Owner (with pgtype.UUID /
// Timestamptz) to Owner (plain Go types, identity only).
// The settings fields are decoded separately via toOwnerSettings (the same
// owners table row split into two facets).
func toDomainOwner(o *db.Owner) entity.Owner {
	return entity.Owner{
		ID:              pgstore.FormatUUID(o.ID),
		Email:           o.Email,
		Handle:          o.Handle,
		FullName:        o.FullName,
		Location:        o.Location,
		PublicURL:       o.PublicUrl,
		ProfileTimezone: o.ProfileTimezone,
		PendingEmail:    derefString(o.PendingEmail),
		CreatedAt:       o.CreatedAt.Time,
	}
}

// derefString —— reads a nullable column's value. A nil pointer yields an
// empty string: what the caller needs to distinguish is "is there a
// pending confirmation," not the difference between NULL and "" (that
// distinction has no meaning on this column).
func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// toOwnerSettings —— assembles Settings from an owners row's byoai_* +
// **the default provider**.
//
// The AI facet used to read the four columns on the owners row directly;
// now that provider is a list, "the owner's AI settings" means **the
// default entry** (the rest are other entries in the list, managed by the
// providers.* group of operations). def == nil means this owner has no
// provider yet (before claim); the AI facet reports zero values.
// The plaintext key never leaves repo — the outer layer only sees
// KeyConfigured.
func toOwnerSettings(o *db.Owner, def *ProviderRow) entity.Settings {
	out := entity.Settings{
		BYOAI: entity.BYOAISettings{
			Enabled:     o.ByoaiEnabled,
			Providers:   decodeProviders(o.ByoaiProviders),
			PublicBlurb: o.ByoaiPublicBlurb,
		},
	}
	if def != nil {
		out.AI = entity.AISettings{
			Provider: def.Provider, Endpoint: def.Endpoint,
			Model: def.Model, KeyConfigured: def.KeyConfigured,
		}
	}
	return out
}

// decodeProviders decodes the byoai_providers jsonb into []string. Empty or
// a decode failure returns an empty slice; usecase treats empty as
// "default providers", and the handler encodes it as [] on output.
func decodeProviders(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var out []string
	if err := json.Unmarshal(raw, &out); err != nil {
		return []string{}
	}
	return out
}

// UpdateBYOAIInput —— Update's input. Field order follows govet
// fieldalignment: strings first (ptr at 0), slice right after (ptr at 0
// too, keeping them contiguous), bool last.
type UpdateBYOAIInput struct {
	OwnerID   string
	Blurb     string
	Providers []string
	Enabled   bool
}

// UpdateBYOAI updates the owner row's byoai_enabled / providers / blurb;
// returns the new OwnerSettings (not the whole Owner — settings is a
// separate facet of the aggregate).
func (r *Repo) UpdateBYOAI(
	ctx context.Context, in *UpdateBYOAIInput,
) (entity.Settings, error) {
	params, perr := buildBYOAIParams(in)
	if perr != nil {
		return entity.Settings{}, perr
	}
	q := db.New(r.pool)
	row, uerr := q.UpdateOwnerBYOAI(ctx, params)
	if uerr != nil {
		if errors.Is(uerr, pgxErrNoRows()) {
			return entity.Settings{}, entity.ErrOwnerNotFound
		}
		return entity.Settings{}, fmt.Errorf("update byoai: %w", uerr)
	}
	return r.settingsFor(ctx, &row), nil
}

// GetSettings —— pulls the settings facet of the owner row (identity
// excluded). Called when the /me endpoint needs owner + settings combined;
// GetByID fetches its own half separately.
func (r *Repo) GetSettings(
	ctx context.Context, ownerID string,
) (entity.Settings, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Settings{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	row, err := q.GetOwnerByID(ctx, pgID)
	if err != nil {
		if errors.Is(err, pgxErrNoRows()) {
			return entity.Settings{}, entity.ErrOwnerNotFound
		}
		return entity.Settings{}, fmt.Errorf("get owner settings: %w", err)
	}
	return r.settingsFor(ctx, &row), nil
}

// buildBYOAIParams normalizes + marshals the input in one pass, keeping
// UpdateBYOAI's own cyclo ≤ 5.
func buildBYOAIParams(in *UpdateBYOAIInput) (db.UpdateOwnerBYOAIParams, error) {
	ownerUUID, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return db.UpdateOwnerBYOAIParams{}, fmt.Errorf(parseOwnerIDErrFmt, err)
	}
	providers := in.Providers
	if providers == nil {
		providers = []string{}
	}
	encoded, merr := json.Marshal(providers)
	if merr != nil {
		return db.UpdateOwnerBYOAIParams{}, fmt.Errorf("marshal providers: %w", merr)
	}
	return db.UpdateOwnerBYOAIParams{
		ID:               ownerUUID,
		ByoaiEnabled:     in.Enabled,
		ByoaiProviders:   encoded,
		ByoaiPublicBlurb: in.Blurb,
	}, nil
}

// UpdatePublicURL —— owner changes the deployment's canonical public URL
// (called when the domain changes after claim). No alias table needed
// (public_url doesn't participate in routing; it's only used for QR / SEO
// canonical), so a single UPDATE suffices.
func (r *Repo) UpdatePublicURL(
	ctx context.Context, ownerID, normalized string,
) (entity.Owner, error) {
	pgID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return entity.Owner{}, fmt.Errorf(parseOwnerIDErrFmt, perr)
	}
	q := db.New(r.pool)
	row, qerr := q.UpdateOwnerPublicURL(ctx, db.UpdateOwnerPublicURLParams{
		ID: pgID, PublicUrl: normalized,
	})
	if qerr != nil {
		return entity.Owner{}, fmt.Errorf("update public_url: %w", qerr)
	}
	return toDomainOwner(&row), nil
}

// settingsFor —— reads the default provider then assembles Settings. No
// default (not yet claimed / just deleted down to empty) is not an error:
// the AI facet reports zero values, and the owner panel shows "not
// configured yet" based on that.
func (r *Repo) settingsFor(ctx context.Context, o *db.Owner) entity.Settings {
	def, err := r.DefaultProvider(ctx, pgstore.FormatUUID(o.ID))
	if err != nil {
		return toOwnerSettings(o, nil)
	}
	return toOwnerSettings(o, &def)
}

// The provider group (view / resolution chain / writing the default entry /
// sealing keys) all lives in providers.go and provider_view.go — this file
// only handles the owner itself: identity, byoai, the settings facet.
