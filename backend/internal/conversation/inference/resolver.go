// resolver.go —— per-owner / per-byoai-visitor credential resolution.
// visitor chat can't import postgres directly (cycle), so resolver takes
// a narrow `OwnerLookup` interface; caller injects it. The two sources have
// two TYPES — exported `VisitorCred` (visitor-supplied, untrusted by
// construction) and unexported `ownerCred` (never leaves this package); see
// visitor_cred.go. Resolver returns a *Cred (the "ready to call /v1/messages"
// form), whose Untrusted flag is set by WHICH path built it, not by its caller.
//
// Policy:
//  1. mode='byoai' + non-empty visitor cred → use that
//  2. otherwise → look up owner row, decrypt key
//  3. owner.ai_provider_key_enc empty → ErrOwnerProviderUnconfigured

package inference

import (
	"context"
	"errors"
	"fmt"
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

// ResolveInput —— per-request input. Visitor non-nil only in mode='byoai'.
// fieldalignment: pointer first.
type ResolveInput struct {
	// Visitor —— the credential the visitor brought themselves (BYOAI). The type itself
	// already says it's untrusted, see visitor_cred.go.
	Visitor *VisitorCred
	OwnerID string
	Mode    string
	// ProviderID —— **which** provider in the owner's book this session uses. Empty = the
	// default one. Which one wins (code > role > default) was already decided and frozen in
	// when the session was sent; this just reads it back.
	ProviderID string
}

// OwnerKeyResolver —— the Resolver impl: reads the owner row, gets back an already-unsealed
// credential. **Never unseals** — see OwnerKeyView.Key in owner_lookup.go.
type OwnerKeyResolver struct {
	Lookup OwnerLookup
}

// Resolve —— implement Resolver interface.
func (r *OwnerKeyResolver) Resolve(
	ctx context.Context, in *ResolveInput,
) (*Cred, error) {
	if in.Mode == "byoai" && in.Visitor.HasKey() {
		// Untrusted is decided by **this path**, never passed in by the caller — the endpoint
		// the visitor gave must pass through the SSRF gate.
		return validateCred(credFields{
			Provider: in.Visitor.Provider, Key: in.Visitor.Key,
			Endpoint: in.Visitor.Endpoint, Model: in.Visitor.Model, Untrusted: true,
		})
	}
	cred, err := r.loadOwnerCred(ctx, in.OwnerID, in.ProviderID)
	if err != nil {
		return nil, err
	}
	return validateCred(credFields{
		Provider: cred.Provider, Key: cred.Key,
		Endpoint: cred.Endpoint, Model: cred.Model,
	})
}

func (r *OwnerKeyResolver) loadOwnerCred(
	ctx context.Context, ownerID, providerID string,
) (ownerCred, error) {
	view, err := r.Lookup.LookupForResolver(ctx, ownerID, providerID)
	if err != nil {
		return ownerCred{}, fmt.Errorf("resolve owner provider: %w", err)
	}
	if view.Key == "" {
		return ownerCred{}, ErrOwnerProviderUnconfigured
	}
	return ownerCred{
		Provider: view.Provider, Key: view.Key,
		Endpoint: view.Endpoint, Model: view.Model,
	}, nil
}

// validateCred —— enforce that all four fields are populated before
// returning a Cred. preset table only fills UI defaults; server doesn't
// fall back at request time.
// credFields —— the shared validation input for both source paths. Untrusted is
// **a property of the path**, filled in by the call site based on which path it is, never
// passed in from outside.
type credFields struct {
	Provider  string
	Key       string
	Endpoint  string
	Model     string
	Untrusted bool
}

func validateCred(in credFields) (*Cred, error) {
	if in.Provider == "" {
		return nil, errors.New("cred missing provider")
	}
	if in.Endpoint == "" || in.Model == "" {
		return nil, fmt.Errorf("provider %q requires endpoint + model", in.Provider)
	}
	return &Cred{
		Provider: in.Provider, Key: in.Key,
		Endpoint: in.Endpoint, Model: in.Model, Untrusted: in.Untrusted,
	}, nil
}
