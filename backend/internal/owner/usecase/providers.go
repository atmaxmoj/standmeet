// providers.go — the owner's provider book: add/delete/edit, mark default.
//
// "The owner's AI provider" (ai_provider.set / the setup wizard / claim) refers to the
// **default one**, which is unchanged in ai_provider.go. This file manages the book
// itself: the extra entries beyond that, which one is default, which one to delete.
//
// Two rules:
//   · Deleting one that's referenced -> the reference on code/role is set to null
//     (schema's ON DELETE SET NULL), falls back to default on read. So there's **no
//     need** to unbind first before deleting, and the owner doesn't need to know who
//     references it.
//   · **The default one can't be deleted** — deleting it would leave nothing to fall
//     back to. The owner must either move the default elsewhere first, or keep it.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// ProvidersDeps — what this group needs. Validator is the same narrow port as
// AIProviderDeps (owner doesn't depend back on inference; the composition root adapts it).
type ProvidersDeps struct {
	Owners    *repo.Repo
	Providers ProviderValidator
	// Spend — sums usage (implemented by the stats domain, wired up by the composition
	// root). nil = this instance doesn't record usage, so every tank reads as
	// "unmetered" — not as "full".
	Spend SpendReader
}

// CreateProviderInput — creates a new entry. Key is **plaintext**; repo's layer seals
// it; outbound is always just KeyConfigured.
type CreateProviderInput struct {
	OwnerID   string
	Label     string
	Provider  string
	Endpoint  string
	Model     string
	Key       string
	IsDefault bool
}

// ProviderWithGas — one entry in the book + how much fuel is left in it (nil = no
// meter attached). Remaining isn't stored on the row, so it travels alongside the row
// instead of making every caller recompute it.
type ProviderWithGas struct {
	Remaining *int64
	Row       repo.ProviderRow
}

// ListProviders — the owner's book (the default entry first), each entry with its
// gas-meter reading attached.
func ListProviders(
	ctx context.Context, d ProvidersDeps, ownerID string,
) ([]ProviderWithGas, error) {
	rows, err := d.Owners.ListProviders(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list providers: %w", err)
	}
	out := make([]ProviderWithGas, 0, len(rows))
	for i := range rows {
		left, rerr := ProviderRemaining(ctx, d.Spend, &rows[i])
		if rerr != nil {
			return nil, rerr
		}
		out = append(out, ProviderWithGas{Row: rows[i], Remaining: left})
	}
	return out, nil
}

// GasRemaining — how much is left on a given provider (nil = no meter attached). The
// gate that blocks visitors goes through this.
func GasRemaining(
	ctx context.Context, d ProvidersDeps, ownerID, providerID string,
) (*int64, error) {
	row, err := d.Owners.GetProvider(ctx, ownerID, providerID)
	if err != nil {
		return nil, fmt.Errorf("load provider for gas: %w", err)
	}
	return ProviderRemaining(ctx, d.Spend, &row)
}

// DefaultProviderID — the id of the owner's default provider.
//
// **Why the visitor path needs to ask this** (pentest 2026-09-01): a session that
// specifies no provider (public / anonymous / a code with no provider bound) **falls
// back to the default one** at turn time and genuinely spends the owner's money. But
// provider_id stayed an empty string throughout its session — so usage never got
// charged against that tank, and the gas gate (metered && id!="") never fired either.
// Even if the owner set a meter on the default provider, it did nothing to stop
// anonymous spending. Freezing this id in at session-issue time is what lets downstream
// accounting and the gate see which tank is actually being drawn from.
//
// When there's no provider, returns "" + nil: that's a normal state (the instance
// hasn't configured a key yet), not an error — leave it empty, and turn will report
// "not configured" on its own when the time comes, same as today.
func DefaultProviderID(ctx context.Context, d ProvidersDeps, ownerID string) (string, error) {
	row, err := d.Owners.DefaultProvider(ctx, ownerID)
	if err != nil {
		if errors.Is(err, entity.ErrProviderNotFound) {
			return "", nil
		}
		return "", fmt.Errorf("default provider id: %w", err)
	}
	return row.ID, nil
}

// CreateProvider — creates one entry. The provider name must be in the preset table
// (same ruler as changing the default one); label is a name the owner picks himself,
// unique within that owner (backstopped by a DB UNIQUE constraint).
//
// When IsDefault=true, **clear first, then set**: the partial unique index makes "two
// defaults" outright impossible to persist, so getting the order wrong hits the index —
// which is exactly what it's there to do.
func CreateProvider(
	ctx context.Context, d ProvidersDeps, in *CreateProviderInput,
) (repo.ProviderRow, error) {
	if verr := validateProviderInput(d, in); verr != nil {
		return repo.ProviderRow{}, verr
	}
	// The book's first entry is always the default: otherwise this owner would have a
	// provider with no fallback to retreat to.
	makeDefault, ferr := shouldBeDefault(ctx, d, in)
	if ferr != nil {
		return repo.ProviderRow{}, ferr
	}
	row, cerr := d.Owners.CreateProviderPlain(ctx, &repo.CreateProviderPlainInput{
		OwnerID: in.OwnerID, Label: in.Label, Provider: in.Provider,
		Endpoint: in.Endpoint, Model: in.Model, KeyPlaintext: in.Key,
		IsDefault: false, // created non-default; goes through SetDefault's clear-then-set
	})
	if cerr != nil {
		return repo.ProviderRow{}, fmt.Errorf("create provider: %w", cerr)
	}
	if !makeDefault {
		return row, nil
	}
	return markDefault(ctx, d, &row)
}

// shouldBeDefault — either the owner wants it as default, or it's the book's first entry.
func shouldBeDefault(
	ctx context.Context, d ProvidersDeps, in *CreateProviderInput,
) (bool, error) {
	if in.IsDefault {
		return true, nil
	}
	return firstProviderForOwner(ctx, d, in.OwnerID)
}

// markDefault — sets the just-created entry as default (goes through the "clear then
// set" step), returns the marked row.
func markDefault(
	ctx context.Context, d ProvidersDeps, row *repo.ProviderRow,
) (repo.ProviderRow, error) {
	if serr := d.Owners.SetDefaultProvider(ctx, row.OwnerID, row.ID); serr != nil {
		return repo.ProviderRow{}, fmt.Errorf("mark new provider default: %w", serr)
	}
	out := *row
	out.IsDefault = true
	return out, nil
}

func firstProviderForOwner(
	ctx context.Context, d ProvidersDeps, ownerID string,
) (bool, error) {
	rows, err := d.Owners.ListProviders(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("list providers: %w", err)
	}
	return len(rows) == 0, nil
}

func validateProviderInput(d ProvidersDeps, in *CreateProviderInput) error {
	if strings.TrimSpace(in.Label) == "" {
		return apierr.ErrEmptyField
	}
	if d.Providers != nil && !d.Providers.Known(in.Provider) {
		// Same reporting style as changing the default one (apierr.ErrEmptyField is this
		// domain's unified code for "bad input"), so the same mistake doesn't translate
		// into two different responses on two different paths.
		return fmt.Errorf("%w: unknown provider %q", apierr.ErrEmptyField, in.Provider)
	}
	return nil
}

// SetDefaultProvider — moves the default to this entry.
func SetDefaultProvider(ctx context.Context, d ProvidersDeps, ownerID, id string) error {
	if err := d.Owners.SetDefaultProvider(ctx, ownerID, id); err != nil {
		return fmt.Errorf("set default provider: %w", err)
	}
	return nil
}

// UpdateProvider — a partial update (including topping up fuel: SetGas).
func UpdateProvider(
	ctx context.Context, d ProvidersDeps, in *repo.UpdateProviderInput,
) (repo.ProviderRow, error) {
	row, err := d.Owners.UpdateProvider(ctx, in)
	if err != nil {
		return repo.ProviderRow{}, fmt.Errorf("update provider: %w", err)
	}
	return row, nil
}

// DeleteProvider — deletes one entry. The default one is blocked (ErrProviderIsDefault),
// letting the surface return 409 + a human sentence; everything else deletes normally,
// and any code/role referencing it falls back to default naturally.
func DeleteProvider(ctx context.Context, d ProvidersDeps, ownerID, id string) error {
	row, gerr := d.Owners.GetProvider(ctx, ownerID, id)
	if gerr != nil {
		return fmt.Errorf("load provider before delete: %w", gerr)
	}
	if row.IsDefault {
		return entity.ErrProviderIsDefault
	}
	if err := d.Owners.DeleteProvider(ctx, ownerID, id); err != nil {
		return fmt.Errorf("delete provider: %w", err)
	}
	return nil
}
