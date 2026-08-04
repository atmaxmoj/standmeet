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
	// Visitor —— 访客自带的凭据(BYOAI)。类型本身就说明它不可信,见 visitor_cred.go。
	Visitor *VisitorCred
	OwnerID string
	Mode    string
}

// OwnerKeyResolver —— Resolver impl:读 owner 行,拿到一份已经开好的凭据。
// **不解封** —— 见 owner_lookup.go 的 OwnerKeyView.Key。
type OwnerKeyResolver struct {
	Lookup OwnerLookup
}

// Resolve —— implement Resolver interface.
func (r *OwnerKeyResolver) Resolve(
	ctx context.Context, in *ResolveInput,
) (*Cred, error) {
	if in.Mode == "byoai" && in.Visitor.HasKey() {
		// Untrusted 由**这条路径**决定,不由调用方传 —— 访客给的 endpoint 必须过 SSRF 闸。
		return validateCred(credFields{
			Provider: in.Visitor.Provider, Key: in.Visitor.Key,
			Endpoint: in.Visitor.Endpoint, Model: in.Visitor.Model, Untrusted: true,
		})
	}
	cred, err := r.loadOwnerCred(ctx, in.OwnerID)
	if err != nil {
		return nil, err
	}
	return validateCred(credFields{
		Provider: cred.Provider, Key: cred.Key,
		Endpoint: cred.Endpoint, Model: cred.Model,
	})
}

func (r *OwnerKeyResolver) loadOwnerCred(
	ctx context.Context, ownerID string,
) (ownerCred, error) {
	view, err := r.Lookup.LookupForResolver(ctx, ownerID)
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
// credFields —— 两条来路共用的校验入参。Untrusted 是**来路的属性**,由调用处按自己
// 是哪条路填,不从外面传进来。
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
