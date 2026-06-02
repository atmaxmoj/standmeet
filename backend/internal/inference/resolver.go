// resolver.go —— per-owner / per-byoai-visitor credential resolution.
// visitor chat can't import postgres directly (cycle), so resolver takes
// a narrow `OwnerLookup` interface; caller injects it. AICredential
// (provider+key+endpoint+model) is the shared shape between visitor
// BYOAI envelopes and owner DB rows; resolver returns a *Cred (the
// "ready to call /v1/messages" form).
//
// Policy:
//  1. mode='byoai' + non-empty BYOAI cred → use that
//  2. otherwise → look up owner row, decrypt key
//  3. owner.ai_provider_key_enc empty → ErrOwnerProviderUnconfigured

package inference

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// OwnerKeyResolver —— Resolver impl that loads owner row + decrypts key.
type OwnerKeyResolver struct {
	Lookup    OwnerLookup
	Decrypter KeyDecrypter
}

// Resolve —— implement Resolver interface.
func (r *OwnerKeyResolver) Resolve(
	ctx context.Context, in *ResolveInput,
) (*Cred, error) {
	if in.Mode == "byoai" && in.BYOAI.HasKey() {
		return validateCred(in.BYOAI)
	}
	cred, err := r.loadOwnerCred(ctx, in.OwnerID)
	if err != nil {
		return nil, err
	}
	return validateCred(&cred)
}

func (r *OwnerKeyResolver) loadOwnerCred(
	ctx context.Context, ownerID string,
) (domain.AICredential, error) {
	view, err := r.Lookup.LookupForResolver(ctx, ownerID)
	if err != nil {
		return domain.AICredential{}, fmt.Errorf("resolve owner provider: %w", err)
	}
	if len(view.KeyEnc) == 0 {
		return domain.AICredential{}, ErrOwnerProviderUnconfigured
	}
	keyBytes, derr := r.Decrypter(view.KeyEnc)
	if derr != nil {
		return domain.AICredential{}, fmt.Errorf("decrypt owner ai key: %w", derr)
	}
	return domain.AICredential{
		Provider: view.Provider, Key: string(keyBytes),
		Endpoint: view.Endpoint, Model: view.Model,
	}, nil
}

// validateCred —— enforce that all four fields are populated before
// returning a Cred. preset table only fills UI defaults; server doesn't
// fall back at request time.
func validateCred(cred *domain.AICredential) (*Cred, error) {
	if cred.Provider == "" {
		return nil, errors.New("cred missing provider")
	}
	if cred.Endpoint == "" || cred.Model == "" {
		return nil, fmt.Errorf("provider %q requires endpoint + model", cred.Provider)
	}
	return &Cred{
		Provider: cred.Provider, Key: cred.Key,
		Endpoint: cred.Endpoint, Model: cred.Model,
	}, nil
}
