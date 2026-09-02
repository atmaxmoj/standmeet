// assemble.go — manifest → assembled connector. A unified assembly entry point:
// built-in (spec+binding files in the repo) and uploaded (pasted by the owner in the
// UI) both go through the **same** Assemble, the only difference is where the
// manifest data comes from. Assembly = parse spec + binding → validate self-
// consistency → pick an auth strategy → build the runtime → wrap it into the matching
// contract adapter for its category.

package connector

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// errConnectorWrap — the shared prefix for assembly-time errors (carries the
// connector id).
const errConnectorWrap = "connector %q: %w"

// Manifest — a connector's declaration (data, not code). openapi: spec+binding
// (+ the owner-picked AuthScheme); protocol: the Protocol field selects a built-in
// protocol runtime (P3). Built-in and uploaded share the same shape, only the data
// source differs.
type Manifest struct {
	ID       string
	Kind     string // "openapi" | "protocol"
	Category string
	Protocol string // protocol kind: "smtp" | "caldav"
	// AuthScheme — openapi: the securityScheme key the owner picked (empty = the
	// sole one in the spec).
	AuthScheme string
	Spec       []byte
	Binding    []byte
	// OwnerOps — the owner-side operations this connector declares for itself (see
	// owner_op.go). Empty = it only has the generic registry set (list/connect/
	// disconnect/delete), no category-specific actions.
	OwnerOps []OwnerOp
	// ExposeAsAgentTools — openapi: expose raw operations as agent tools (§3, can
	// have no binding).
	ExposeAsAgentTools bool
}

// parsed — the parsed + validated spec/binding (function-result-limit is ≤2, so this
// carries them as a struct).
type parsed struct {
	spec    *openapi.Spec
	binding *openapi.Binding
}

// AssembleOpenAPI — assemble an openapi manifest into a Connector. Any failure in
// parse/validate/pick-strategy → error (rejected on the spot at assembly time, with a
// friendly message back to admin). The concrete type returned is calendarAdapter or
// mailAdapter, depending on the bound category.
func AssembleOpenAPI(
	m *Manifest, doer openapi.Doer, store ConnectionStore, allow EgressAllow,
) (Connector, error) {
	p, err := parseAndValidate(m, allow)
	if err != nil {
		return nil, err
	}
	auth, aerr := resolveAuth(p.spec, m.AuthScheme)
	if aerr != nil {
		return nil, fmt.Errorf(errConnectorWrap, m.ID, aerr)
	}
	rt, rerr := openapi.NewRuntime(p.spec, p.binding, doer)
	if rerr != nil {
		return nil, fmt.Errorf(errConnectorWrap, m.ID, rerr)
	}
	core := &openapiCore{
		runtime: rt, store: store, auth: auth, id: m.ID, expose: m.ExposeAsAgentTools,
		refresher: buildRefresher(p.spec, m.AuthScheme, doer, store),
	}
	if p.binding == nil {
		// agent-only (§3): no category binding → doesn't occupy a category slot, the
		// bare core is both a Connector and an AgentToolConnector.
		return core, nil
	}
	return adaptByCategory(p.binding.Category, core)
}

// checkEgress — assembly-time static SSRF check: servers[].url + oauth token URL
// pointing at an internal address → reject (don't build the connector). The authorize
// URL is followed by the browser, the backend never hits it, so it's not checked
// (otherwise e2e's localhost authorize would get wrongly blocked).
func checkEgress(spec *openapi.Spec, schemeName string, allow EgressAllow) error {
	for _, u := range spec.ServerURLs() {
		if err := allow.CheckEgressURL(u); err != nil {
			return err
		}
	}
	if ep, err := oauthEndpointsFromSpec(spec, schemeName); err == nil {
		if cerr := allow.CheckEgressURL(ep.TokenURL); cerr != nil {
			return cerr
		}
	}
	return nil
}

// BindingCategory — parse a manifest's binding and pull out the declared category
// (used by admin when creating an uploaded connector, to decide which slot it fills).
func BindingCategory(m *Manifest) (string, error) {
	b, err := openapi.ParseBinding(m.Binding)
	if err != nil {
		return "", fmt.Errorf(errConnectorWrap, m.ID, err)
	}
	return b.Category, nil
}

// parseAndValidate — parse spec → SSRF egress check (the security gate runs before
// binding semantics) → parse binding + validate self-consistency.
func parseAndValidate(m *Manifest, allow EgressAllow) (parsed, error) {
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return parsed{}, fmt.Errorf(errConnectorWrap, m.ID, err)
	}
	if eerr := checkEgress(spec, m.AuthScheme, allow); eerr != nil {
		return parsed{}, fmt.Errorf(errConnectorWrap, m.ID, eerr)
	}
	if len(m.Binding) == 0 {
		// agent-only connector (§3): no category binding, only exposes raw ops to the
		// agent. spec+egress are still validated.
		return parsed{spec: spec, binding: nil}, nil
	}
	binding, berr := parseBindingFor(m, spec)
	if berr != nil {
		return parsed{}, berr
	}
	return parsed{spec: spec, binding: binding}, nil
}

// parseBindingFor — parse the binding + validate it's self-consistent with the spec
// (every op it references actually exists).
func parseBindingFor(m *Manifest, spec *openapi.Spec) (*openapi.Binding, error) {
	binding, berr := openapi.ParseBinding(m.Binding)
	if berr != nil {
		return nil, fmt.Errorf(errConnectorWrap, m.ID, berr)
	}
	if verr := binding.ValidateAgainst(spec); verr != nil {
		return nil, fmt.Errorf(errConnectorWrap, m.ID, verr)
	}
	return binding, nil
}

// resolveAuth — pick a securityScheme + build the injection strategy.
func resolveAuth(spec *openapi.Spec, schemeName string) (authStrategy, error) {
	scheme, serr := pickScheme(spec, schemeName)
	if serr != nil {
		return nil, serr
	}
	return buildAuthStrategy(&scheme)
}

// pickScheme — pick the securityScheme the owner named; unnamed and there's only one
// → use it; unnamed with several candidates → reject (decision #3: the owner must
// choose); none at all → reject. Owner names "manual:*" → synthesize a scheme
// (F-H-2: vendor specs often leave securitySchemes empty, so letting the owner
// manually pick bearer/apikey/basic still lets a usable connector get assembled).
func pickScheme(spec *openapi.Spec, name string) (openapi.SecurityScheme, error) {
	if s, ok := openapi.ManualScheme(name); ok {
		return s, nil
	}
	schemes := spec.SecuritySchemes()
	if len(schemes) == 0 {
		return openapi.SecurityScheme{}, errNoAuthScheme
	}
	if name != "" {
		return schemeByName(schemes, name)
	}
	return soleScheme(schemes)
}

func schemeByName(
	schemes map[string]openapi.SecurityScheme, name string,
) (openapi.SecurityScheme, error) {
	s, ok := schemes[name]
	if !ok {
		return openapi.SecurityScheme{}, fmt.Errorf("%w: %q", errUnknownScheme, name)
	}
	return s, nil
}

func soleScheme(schemes map[string]openapi.SecurityScheme) (openapi.SecurityScheme, error) {
	if len(schemes) > 1 {
		return openapi.SecurityScheme{}, errSchemeAmbiguous
	}
	for _, s := range schemes {
		return s, nil
	}
	return openapi.SecurityScheme{}, errNoAuthScheme
}

// adaptByCategory — wrap the execution core into the matching contract adapter by
// category. Unknown category → error.
func adaptByCategory(category string, core *openapiCore) (Connector, error) {
	switch category {
	case "calendar":
		return calendarAdapter{core}, nil
	case "mail":
		return mailAdapter{core}, nil
	default:
		return nil, fmt.Errorf("%w: %q", openapi.ErrBindingUnknownCategory, category)
	}
}
