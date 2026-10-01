// openapi_block_behavior.go — the host-side half of an openapi supplier. Every openapi
// supplier's CALLS run in a sandbox block (the JS openapi engine): google-calendar's own block,
// and the shared openapi block for owner-uploaded suppliers and bearer-api. What stays here is
// what needs the host: `Connected` reads the connection row, `CanPerform` compares the spec's
// per-op scope against the grant (F-B-8), `AuthFor` runs the silent OAuth refresh and resolves
// the owner's credentials into the headers/query the block applies, and the agent-tool metadata
// is read off the spec.

package adapters

import (
	"context"
	"fmt"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/infra/egress"
	"github.com/atmaxmoj/standmeet/internal/infra/openapi"
	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// OpenAPIBehavior — the host-side half of one openapi supplier.
type OpenAPIBehavior struct {
	spec      *openapi.Spec
	store     ConnectionStore
	auth      authStrategy
	refresher *oauthRefresher // oauth2 silent refresh; nil for non-oauth2
	id        string
	seam      string // the binding's seam; "" = agent-only (§3)
	baseURL   string
	// specRaw / bindingRaw — the definition as stored, handed to the shared openapi block on
	// every call (it ships no spec of its own).
	specRaw    []byte
	bindingRaw []byte
	expose     bool // expose_as_agent_tools: raw operations as agent tools (§3)
}

// AssembleOpenAPIBehavior — parse + validate (SSRF static check, binding against the spec),
// pick the auth strategy, build the refresher. Any failure is rejected at assembly time with a
// friendly message back to admin.
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
	base := firstServerURL(p.spec)
	if base == "" {
		return nil, fmt.Errorf(errSupplierWrap, m.ID, openapi.ErrSpecNoServer)
	}
	b := &OpenAPIBehavior{
		spec: p.spec, store: store, auth: auth, id: m.ID, baseURL: base,
		refresher: buildRefresher(p.spec, m.AuthScheme, doer, store),
		specRaw:   m.Spec, bindingRaw: m.Binding, expose: m.ExposeAsAgentTools,
	}
	if p.binding != nil {
		b.seam = p.binding.Seam
	}
	return b, nil
}

// firstServerURL — the spec's first server url (host-expanded at manifest load), or "".
func firstServerURL(spec *openapi.Spec) string {
	urls := spec.ServerURLs()
	if len(urls) == 0 {
		return ""
	}
	return urls[0]
}

// ID — which supplier.
func (b *OpenAPIBehavior) ID() string { return b.id }

// Seam — which seam its binding fills ("" = agent-only).
func (b *OpenAPIBehavior) Seam() string { return b.seam }

// SpecText / BindingText — the stored definition, for a block that ships no spec of its own.
func (b *OpenAPIBehavior) SpecText() string { return string(b.specRaw) }

// BindingText — see SpecText.
func (b *OpenAPIBehavior) BindingText() string { return string(b.bindingRaw) }

// Connected — is this owner connected (reads the connection row).
func (b *OpenAPIBehavior) Connected(ctx context.Context, ownerID string) (bool, error) {
	conn, err := b.store.Get(ctx, b.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("supplier %q connected: %w", b.id, err)
	}
	return conn.Connected, nil
}

// ExposesAgentTools — whether this supplier offers its raw operations as agent tools (§3).
func (b *OpenAPIBehavior) ExposesAgentTools() bool { return b.expose }

// AgentOps — one agent-tool metadata entry (tool name + summary) per spec op. Name is normalized
// to the provider's charset (agent_tool_name.go); dispatch is by OpID, so renaming it is safe.
func (b *OpenAPIBehavior) AgentOps() []AgentOp {
	ops := b.spec.Operations()
	names := agentToolNames(ops)
	out := make([]AgentOp, 0, len(ops))
	for i := range ops {
		desc := ops[i].Summary
		if desc == "" {
			desc = ops[i].Description
		}
		out = append(out, AgentOp{Name: names[i], OpID: ops[i].ID, Description: desc})
	}
	return out
}

// Auth — what the block needs to make this owner's call: the credentials as headers and query
// parameters (scheme-blind for the block), and the base URL to call.
type Auth struct {
	Headers map[string]string
	Query   map[string]string
	BaseURL string
}

// probeURL — the throwaway request the auth strategy writes onto; only its headers and query
// are read back, it is never sent.
const probeURL = "https://auth.probe/"

// AuthFor — this owner's credentials (an OAuth token silently refreshed if expired), resolved by
// the spec's scheme into headers/query. Empty credentials yield no auth, left to the SaaS to
// refuse — the same as the injector handing over nothing.
func (b *OpenAPIBehavior) AuthFor(ctx context.Context, ownerID string) (Auth, error) {
	conn, err := b.freshConnection(ctx, ownerID)
	if err != nil {
		return Auth{}, err
	}
	inj, ierr := b.auth(&conn)
	if ierr != nil {
		return Auth{}, fmt.Errorf("supplier %q auth: %w", b.id, ierr)
	}
	probe, perr := http.NewRequestWithContext(ctx, http.MethodGet, probeURL, http.NoBody)
	if perr != nil {
		return Auth{}, fmt.Errorf("supplier %q auth probe: %w", b.id, perr)
	}
	if aerr := inj(probe); aerr != nil {
		return Auth{}, fmt.Errorf("supplier %q inject auth: %w", b.id, aerr)
	}
	return Auth{
		Headers: firstValues(probe.Header), Query: firstValues(probe.URL.Query()),
		BaseURL: b.baseURL,
	}, nil
}

// freshConnection — this owner's connection, its OAuth token silently refreshed if expired.
func (b *OpenAPIBehavior) freshConnection(
	ctx context.Context, ownerID string,
) (credentials.Connection, error) {
	conn, err := b.store.Get(ctx, b.id, ownerID)
	if err != nil {
		return conn, fmt.Errorf("supplier %q load: %w", b.id, err)
	}
	if b.refresher == nil {
		return conn, nil
	}
	if rerr := b.refresher.maybeRefresh(ctx, b.id, ownerID, &conn); rerr != nil {
		return conn, fmt.Errorf("supplier %q refresh: %w", b.id, rerr)
	}
	return conn, nil
}

// firstValues — a header or query multimap as name → value (an auth scheme sets one of each).
func firstValues(m map[string][]string) map[string]string {
	out := make(map[string]string, len(m))
	for k, v := range m {
		if len(v) > 0 {
			out[k] = v[0]
		}
	}
	return out
}
