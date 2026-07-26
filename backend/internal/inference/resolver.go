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

	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
)

// Cred —— resolved upstream credential. all four fields non-empty after
// a successful Resolve.
type Cred struct {
	Provider string
	Key      string
	Endpoint string
	Model    string
	// Untrusted —— cred came from a visitor BYOAI envelope (Endpoint is visitor-controlled). Its
	// outbound client gets the SSRF egress guard + the endpoint is pre-validated; owner creds
	// (trusted self-host config, may legitimately point at an internal provider) do not.
	Untrusted bool
}

// Resolver —— pick the right cred for this request (owner row vs visitor
// BYOAI envelope). Implementation: OwnerKeyResolver below.
type Resolver interface {
	Resolve(ctx context.Context, in *ResolveInput) (*Cred, error)
}

// ResolveInput —— per-request input. BYOAI non-nil only in mode='byoai'.
// fieldalignment: pointer first.
type ResolveInput struct {
	BYOAI   *ownerdomain.AICredential
	OwnerID string
	Mode    string
}

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
		cred, verr := validateCred(in.BYOAI)
		if verr != nil {
			return nil, verr
		}
		cred.Untrusted = true // visitor-controlled endpoint → guard egress + pre-validate
		return cred, nil
	}
	cred, err := r.loadOwnerCred(ctx, in.OwnerID)
	if err != nil {
		return nil, err
	}
	return validateCred(&cred)
}

func (r *OwnerKeyResolver) loadOwnerCred(
	ctx context.Context, ownerID string,
) (ownerdomain.AICredential, error) {
	view, err := r.Lookup.LookupForResolver(ctx, ownerID)
	if err != nil {
		return ownerdomain.AICredential{}, fmt.Errorf("resolve owner provider: %w", err)
	}
	if len(view.KeyEnc) == 0 {
		return ownerdomain.AICredential{}, ErrOwnerProviderUnconfigured
	}
	keyBytes, derr := r.Decrypter(ownerID, view.KeyEnc)
	if derr != nil {
		return ownerdomain.AICredential{}, fmt.Errorf("decrypt owner ai key: %w", derr)
	}
	return ownerdomain.AICredential{
		Provider: view.Provider, Key: string(keyBytes),
		Endpoint: view.Endpoint, Model: view.Model,
	}, nil
}

// validateCred —— enforce that all four fields are populated before
// returning a Cred. preset table only fills UI defaults; server doesn't
// fall back at request time.
func validateCred(cred *ownerdomain.AICredential) (*Cred, error) {
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
