// authform.go — #155 zone B: derives a "credential form" description from the spec's
// securitySchemes (which fields the owner should fill, field types, scope multi-select,
// whether apiKey lands in header/query, whether oauth2/oidc needs the dance, oidc discovery
// URL). The generic frontend renderer draws the form from this — no per-connector hand-coding.
// Pure data derivation (§4 auth table).

package openapi

import (
	"slices"
	"strings"
)

// AuthFieldForm — one field in the form. Type: text | password | readonly | scopes.
type AuthFieldForm struct {
	Key    string   `json:"key"`
	Type   string   `json:"type"`
	Scopes []string `json:"scopes,omitempty"`
}

// AuthSchemeForm — the form derived from one securityScheme. Scheme = the scheme's name in
// the spec (used by the multi-scheme selector).
type AuthSchemeForm struct {
	Scheme       string          `json:"scheme"`
	Type         string          `json:"type"` // oauth2 | oidc | apikey | basic | bearer
	In           string          `json:"in,omitempty"`
	ParamName    string          `json:"param_name,omitempty"`
	DiscoveryURL string          `json:"discovery_url,omitempty"`
	Fields       []AuthFieldForm `json:"fields"`
	NeedsDance   bool            `json:"needs_dance"`
}

// AuthForms — the derivation result for one spec: a set of selectable schemes; Note non-empty
// means no usable/supported authentication (a hint shown to the owner).
type AuthForms struct {
	Note  string           `json:"note,omitempty"`
	Forms []AuthSchemeForm `json:"forms,omitempty"`
}

// manualSchemeNames — F-H-2 manual fallback schemes (offered to the owner to pick from when
// the spec declares no securitySchemes).
var manualSchemeNames = []string{"manual:bearer", "manual:apikey", "manual:basic"}

// ManualScheme — maps a "manual:*" scheme name to a synthetic SecurityScheme. Real vendor
// specs often leave components.securitySchemes empty (Cal.com v2 does), yet the API still
// requires Authorization: Bearer. Rather than hard-reject, let the owner manually pick a
// generic scheme (bearer/apiKey-header/basic), and build an injector from it at assembly
// time (F-H-2). Returns (scheme, true) on a hit, otherwise (zero value, false).
func ManualScheme(name string) (SecurityScheme, bool) {
	switch name {
	case "manual:bearer":
		return SecurityScheme{Type: "http", Scheme: "bearer"}, true
	case "manual:basic":
		return SecurityScheme{Type: "http", Scheme: "basic"}, true
	case "manual:apikey":
		return SecurityScheme{
			Type: "apiKey", In: "header", Name: "Authorization",
		}, true
	default:
		return SecurityScheme{}, false
	}
}

// manualFallbackForms — the three generic scheme forms offered to the owner when the spec
// has no securitySchemes (F-H-2).
func manualFallbackForms() AuthForms {
	forms := make([]AuthSchemeForm, 0, len(manualSchemeNames))
	for _, name := range manualSchemeNames {
		s, _ := ManualScheme(name)
		if f, ok := authSchemeForm(name, &s); ok {
			forms = append(forms, f)
		}
	}
	return AuthForms{
		Note:  "this spec declares no authentication — if the API needs a key, pick one below",
		Forms: forms,
	}
}

// DeriveAuthForms — walks the spec's securitySchemes and derives forms. No schemes → manual
// fallback (F-H-2); none supported → unsupported note; otherwise returns them sorted by
// scheme name (the frontend gives a selector when there are several).
func DeriveAuthForms(spec *Spec) AuthForms {
	schemes := spec.SecuritySchemes()
	if len(schemes) == 0 {
		return manualFallbackForms()
	}
	forms := make([]AuthSchemeForm, 0, len(schemes))
	unsupported := make([]string, 0)
	for _, name := range sortedKeys(schemes) {
		s := schemes[name]
		if f, ok := authSchemeForm(name, &s); ok {
			forms = append(forms, f)
		} else {
			unsupported = append(unsupported, s.Type)
		}
	}
	if len(forms) == 0 {
		note := "unsupported authentication type: " + strings.Join(unsupported, ", ")
		return AuthForms{Note: note}
	}
	return AuthForms{Forms: forms}
}

// sortedKeys — sorts securityScheme names (a deterministic scheme order, so the multi-scheme
// selector stays stable).
func sortedKeys(schemes map[string]SecurityScheme) []string {
	names := make([]string, 0, len(schemes))
	for name := range schemes {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// authSchemeForm — a single securityScheme → form. oauth2/oidc share a shape; everything
// else is handed off to nonOAuthForm.
func authSchemeForm(name string, s *SecurityScheme) (AuthSchemeForm, bool) {
	switch s.Type {
	case "oauth2":
		return oauthForm(name, "oauth2", oauthScopes(s), ""), true
	case "openIdConnect":
		return oauthForm(name, "oidc", []string{}, s.OpenIDConnectURL), true
	default:
		return nonOAuthForm(name, s)
	}
}

// nonOAuthForm — non-oauth schemes: apiKey (key + header/query location) / http (basic|bearer).
func nonOAuthForm(name string, s *SecurityScheme) (AuthSchemeForm, bool) {
	switch s.Type {
	case "apiKey":
		return AuthSchemeForm{
			Scheme: name, Type: "apikey", In: s.In, ParamName: s.Name,
			Fields: []AuthFieldForm{{Key: "key", Type: "password"}},
		}, true
	case "http":
		return httpSchemeForm(name, s.Scheme), true
	default:
		return AuthSchemeForm{}, false
	}
}

// oauthForm — oauth2 / oidc share a shape: client_id + client_secret + scope multi-select +
// readonly redirect_uri, and the dance is required.
func oauthForm(name, kind string, scopes []string, discovery string) AuthSchemeForm {
	fields := []AuthFieldForm{
		{Key: "client_id", Type: "text"},
		{Key: "client_secret", Type: "password"},
	}
	if len(scopes) > 0 {
		fields = append(fields, AuthFieldForm{Key: "scope", Type: "scopes", Scopes: scopes})
	}
	fields = append(fields, AuthFieldForm{Key: "redirect_uri", Type: "readonly"})
	return AuthSchemeForm{
		Scheme: name, Type: kind, DiscoveryURL: discovery, Fields: fields, NeedsDance: true,
	}
}

// httpSchemeForm — http securityScheme: basic → username/password; everything else
// (bearer) → a single token.
func httpSchemeForm(name, scheme string) AuthSchemeForm {
	if scheme == "basic" {
		return AuthSchemeForm{Scheme: name, Type: "basic", Fields: []AuthFieldForm{
			{Key: "username", Type: "text"}, {Key: "password", Type: "password"},
		}}
	}
	return AuthSchemeForm{Scheme: name, Type: "bearer", Fields: []AuthFieldForm{
		{Key: "token", Type: "password"},
	}}
}

// oauthScopes — every scope declared by the oauth2 authorizationCode flow (sorted, to remove
// differences from op reference order).
func oauthScopes(s *SecurityScheme) []string {
	if s.Flows.AuthorizationCode == nil {
		return []string{}
	}
	out := make([]string, 0, len(s.Flows.AuthorizationCode.Scopes))
	for scope := range s.Flows.AuthorizationCode.Scopes {
		out = append(out, scope)
	}
	slices.Sort(out)
	return out
}
