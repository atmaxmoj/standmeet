// openapi_block_behavior.go — the host-side behavior of an openapi supplier whose CALL
// execution runs in a sandbox block (google-calendar: a spec+oauth supplier, but the HTTP
// to Google runs in the JS openapi block, not in-host).
//
// It reuses the SAME openapiCore as the fully in-host path, so a block-backed openapi
// supplier is identical where it matters: `Connected` reads the connection row, `CanPerform`
// compares the spec's per-op scope against the grant (F-B-8 shortfall preserved), and
// `BearerFor` runs the same silent refresh and hands back the token + resolved base URL for
// the block to bear. Only the request execution moved into the block.

package adapters

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/egress"
	"github.com/atmaxmoj/standmeet/internal/infra/openapi"
)

// OpenAPIBehavior — the reusable host-side half of an openapi supplier executed by a block.
type OpenAPIBehavior struct {
	core    *openapiCore
	baseURL string
}

// AssembleOpenAPIBehavior — build the host-side behavior (no seam contract adapter, no
// in-host call path). Same parse/validate/auth/refresher construction as AssembleOpenAPI.
func AssembleOpenAPIBehavior(
	m *Manifest, doer openapi.Doer, store ConnectionStore, allow egress.Allow,
) (*OpenAPIBehavior, error) {
	p, err := parseAndValidate(m, allow)
	if err != nil {
		return nil, err
	}
	auth, aerr := resolveAuth(p.spec, m.AuthScheme)
	if aerr != nil {
		return nil, fmt.Errorf(errSupplierWrap, m.ID, aerr)
	}
	rt, rerr := openapi.NewRuntime(p.spec, p.binding, doer)
	if rerr != nil {
		return nil, fmt.Errorf(errSupplierWrap, m.ID, rerr)
	}
	core := &openapiCore{
		runtime: rt, store: store, auth: auth, id: m.ID,
		refresher: buildRefresher(p.spec, m.AuthScheme, doer, store),
	}
	return &OpenAPIBehavior{core: core, baseURL: firstServerURL(p.spec)}, nil
}

// firstServerURL — the spec's first server url (host-expanded at manifest load), or "".
func firstServerURL(spec *openapi.Spec) string {
	urls := spec.ServerURLs()
	if len(urls) == 0 {
		return ""
	}
	return urls[0]
}

// Connected — is this owner connected (reads the connection row).
func (b *OpenAPIBehavior) Connected(ctx context.Context, ownerID string) (bool, error) {
	return b.core.Connected(ctx, ownerID)
}

// CanPerform — may this owner's grant do this one operation (F-B-8 scope shortfall).
func (b *OpenAPIBehavior) CanPerform(ctx context.Context, ownerID, opID string) (bool, error) {
	return b.core.CanPerform(ctx, ownerID, opID)
}

// Bearer — the token + base URL a block needs to execute this supplier's calls itself.
type Bearer struct {
	Token   string
	BaseURL string
}

// BearerFor — the owner's current access token (silently refreshed if expired) and the
// resolved base URL, for the block to execute the call itself. An empty token is left to the
// block to reject (unauthenticated) — the same as the in-host injector handing over no auth.
func (b *OpenAPIBehavior) BearerFor(ctx context.Context, ownerID string) (Bearer, error) {
	conn, gerr := b.core.store.Get(ctx, b.core.id, ownerID)
	if gerr != nil {
		return Bearer{}, fmt.Errorf("supplier %q load: %w", b.core.id, gerr)
	}
	if b.core.refresher != nil {
		if rerr := b.core.refresher.maybeRefresh(ctx, b.core.id, ownerID, &conn); rerr != nil {
			return Bearer{}, fmt.Errorf("supplier %q refresh: %w", b.core.id, rerr)
		}
	}
	return Bearer{Token: conn.AccessToken, BaseURL: b.baseURL}, nil
}
