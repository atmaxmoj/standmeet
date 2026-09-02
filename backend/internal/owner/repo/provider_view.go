// provider_view.go —— where the phrase "the owner's AI provider" resolves
// to, plus the view the resolver side needs.
//
// Division of labor with providers.go: that file is **CRUD on the list**
// (create/read/update/delete, who's default); this file is **who that
// phrase points to** — the setup wizard / claim / the old admin form all
// say "the owner's provider" meaning the default entry; a session's
// "which entry to use" is the id decided and frozen in at the time the
// session was issued.
//
// Key sealing happens here (sealProviderKey); unsealing happens at the
// assembly side (cmd/server/unseal.go). Seal only, never unseal (§1.5).

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// UpdateAIProviderInput —— the commit input for the admin "AI provider"
// form. This refers to **the default entry**. KeyPlaintext == nil means
// leave the key alone (only change provider / endpoint / model); an
// explicit empty string clears the key. Endpoint is required only when
// provider='custom'; when Model is left empty the inference resolver
// falls back to the preset default.
type UpdateAIProviderInput struct {
	KeyPlaintext *string
	OwnerID      string
	Provider     string
	Endpoint     string
	Model        string
}

// AIProviderView —— the minimal info the inference resolver needs. KeyEnc
// is ciphertext, **this domain never unseals it**: the owner domain only
// seals (via cryptobox.Encrypt on the write path); unsealing happens at
// the assembly side (cmd/server's openAIProviderKey). Endpoint + Model are
// non-empty only for custom, or when the owner explicitly overrides the
// preset default.
type AIProviderView struct {
	// GasTokens —— how much fuel is left in this tank, in tokens. nil =
	// unmetered (the #7 default path).
	GasTokens  *int64
	Provider   string
	Endpoint   string
	Model      string
	ProviderID string // which tank to write usage back to
	KeyEnc     []byte
}

func providerViewOf(p *ProviderRow) AIProviderView {
	return AIProviderView{
		Provider: p.Provider, Endpoint: p.Endpoint, Model: p.Model, KeyEnc: p.KeyEnc,
		ProviderID: p.ID, GasTokens: p.GasTokens,
	}
}

// GetAIProviderView —— the minimal info for the **default** provider.
// resolver shouldn't import postgres, so this method returns a standalone
// view type; cmd/server wraps it via an adapter into
// inference.OwnerKeyView.
//
// The path that resolves code / role overrides is ResolveProviderView —
// this method is its floor.
func (r *Repo) GetAIProviderView(
	ctx context.Context, ownerID string,
) (AIProviderView, error) {
	def, err := r.DefaultProvider(ctx, ownerID)
	if err != nil {
		if errors.Is(err, entity.ErrProviderNotFound) {
			// No default = not configured yet. The resolver side translates
			// "no key" into ErrOwnerProviderUnconfigured, the same state as
			// the old four-columns-all-empty case.
			return AIProviderView{}, nil
		}
		return AIProviderView{}, err
	}
	return providerViewOf(&def), nil
}

// ProviderViewByID —— names which entry to use; an empty id or a deleted
// entry falls back to default.
//
// **Which one overrides which is not decided at this layer.** The
// `code > role` step is already evaluated and frozen into the session
// when it's issued (same model as RoleSnapshot), so what arrives here is
// already "which entry this session should use". If the entry pointed to
// was deleted → fall back to default, not an error: the owner deleted an
// address, but the order still has to ship.
func (r *Repo) ProviderViewByID(
	ctx context.Context, ownerID, providerID string,
) (AIProviderView, error) {
	if providerID == "" {
		return r.GetAIProviderView(ctx, ownerID)
	}
	row, err := r.GetProvider(ctx, ownerID, providerID)
	if err == nil {
		return providerViewOf(&row), nil
	}
	if !errors.Is(err, entity.ErrProviderNotFound) {
		return AIProviderView{}, err
	}
	return r.GetAIProviderView(ctx, ownerID)
}

// UpdateAIProvider —— commits the owner's **default** provider. When
// KeyPlaintext is non-nil, the key is swapped along with it; when nil,
// the old key is kept (only provider is switched). Returns the new
// OwnerSettings (a separate facet of the aggregate).
//
// This entry point didn't disappear when provider became a list: the
// setup wizard, claim, and the admin form all say "the owner's AI
// provider", and that phrase now refers to the default entry. If there's
// no default yet, one is created and flagged default.
func (r *Repo) UpdateAIProvider(
	ctx context.Context, in *UpdateAIProviderInput,
) (entity.Settings, error) {
	def, derr := r.DefaultProvider(ctx, in.OwnerID)
	if errors.Is(derr, entity.ErrProviderNotFound) {
		return r.createDefaultProvider(ctx, in)
	}
	if derr != nil {
		return entity.Settings{}, derr
	}
	return r.updateDefaultProvider(ctx, &def, in)
}

// createDefaultProvider —— this owner has no provider at all yet: create
// one, mark it default.
func (r *Repo) createDefaultProvider(
	ctx context.Context, in *UpdateAIProviderInput,
) (entity.Settings, error) {
	enc, eerr := sealProviderKey(in.OwnerID, in.KeyPlaintext)
	if eerr != nil {
		return entity.Settings{}, eerr
	}
	if _, cerr := r.CreateProvider(ctx, &CreateProviderInput{
		OwnerID: in.OwnerID, Label: defaultProviderLabel, Provider: in.Provider,
		Endpoint: in.Endpoint, Model: in.Model, KeyEnc: enc, IsDefault: true,
	}); cerr != nil {
		return entity.Settings{}, cerr
	}
	return r.GetSettings(ctx, in.OwnerID)
}

// updateDefaultProvider —— changes the default entry. KeyPlaintext == nil
// means leave the key alone.
func (r *Repo) updateDefaultProvider(
	ctx context.Context, def *ProviderRow, in *UpdateAIProviderInput,
) (entity.Settings, error) {
	if _, uerr := r.UpdateProvider(ctx, &UpdateProviderInput{
		OwnerID: in.OwnerID, ID: def.ID,
		Provider: &in.Provider, Endpoint: &in.Endpoint, Model: &in.Model,
	}); uerr != nil {
		return entity.Settings{}, uerr
	}
	if in.KeyPlaintext == nil {
		return r.GetSettings(ctx, in.OwnerID)
	}
	enc, eerr := sealProviderKey(in.OwnerID, in.KeyPlaintext)
	if eerr != nil {
		return entity.Settings{}, eerr
	}
	if serr := r.SetProviderKey(ctx, in.OwnerID, def.ID, enc); serr != nil {
		return entity.Settings{}, serr
	}
	return r.GetSettings(ctx, in.OwnerID)
}

// defaultProviderLabel —— the name of the default entry created by the
// setup wizard / claim. The owner can rename it later.
const defaultProviderLabel = "default"

// sealProviderKey —— nil / empty = empty ciphertext (no key configured);
// non-empty → seal it.
//
// **AAD = owner_id**, matching the unseal side (cmd/server/unseal.go's
// openAIProviderKey): the ciphertext is bound to this owner, so moving it
// to a different owner's row fails the tamper check on unseal. This pair
// must change together — sealing without AAD and unsealing with it is
// simply unsolvable, and the symptom looks like "the key suddenly stopped
// working". **Seal only, never unseal**: this side never unseals (§1.5).
func sealProviderKey(ownerID string, key *string) ([]byte, error) {
	if key == nil || *key == "" {
		return []byte{}, nil
	}
	enc, err := cryptobox.Encrypt([]byte(*key), []byte(ownerID))
	if err != nil {
		return nil, fmt.Errorf("encrypt provider key: %w", err)
	}
	return enc, nil
}
