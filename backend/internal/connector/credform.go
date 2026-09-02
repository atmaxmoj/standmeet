// credform.go — derives the "credential form" from an openapi spec: which fields the owner
// must fill in to connect this connector.
// **Single source of truth**: fields/types/scopes all come from openapi.DeriveAuthForms
// (authform); this file only narrows its richer AuthSchemeForm down to the CredentialForm the
// configure form needs. Ingestion preview (authform) and the configure form (this file) used to
// each enumerate their own copy of auth knowledge and drift apart — the apiKey field name
// ('key' vs the scheme name), oidc being treated as token — both leaked from exactly that.
// Once collapsed to one place, adding/changing an auth type only touches authform once. Pure
// data derivation; never touches the credentials themselves.

package connector

import (
	"errors"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// errNoUsableScheme —— the chosen securityScheme has no usable form (no such name / multiple
// schemes and none picked). An assembled connector's scheme is always backed by authform, so
// this error is actually unreachable; kept as an explicit fallback rather than a silent empty
// form.
var errNoUsableScheme = errors.New("no usable auth scheme for credential form")

// CredentialForm — the credential form a connector asks the owner to fill in: auth type + list
// of field keys + oauth2 checkable scopes + every securityScheme name the spec declares (lets
// the owner pick among multiple schemes).
type CredentialForm struct {
	AuthType string
	Fields   []string
	Scopes   []string
	Schemes  []string
	// Granted — the scope this connection **was actually granted at the time**. This is a
	// different thing from Scopes: Scopes is what this connector **supports** (derived from
	// the spec), Granted is what the owner **actually granted** (the row in storage). The
	// panel needs to check the boxes already granted, and before this field existed
	// **nothing reported it anywhere** — so that row of checkboxes was permanently empty
	// (F-C-33).
	Granted []string
	// Shortfall — the specific actions this grant **cannot perform**, and which scope each
	// one is missing (F-B-8).
	//
	// Why the card must show this row: `connected` says "we're holding a token", and an owner
	// reading it assumes that means "this connection can do what it's asked to do". When only
	// `calendar.readonly` was granted, those two facts diverge — reads work, listing free/busy
	// works, but writes can never work, and the card doesn't say a word about it.
	//
	// Both sides are data, neither is copied in: what's needed lives in the spec's per-op
	// `security:`, what was granted lives on the connection row.
	Shortfall []ScopeShortfall
}

// ScopeShortfall — one action the connection can't perform. `Needs` lists only **what's still
// missing**, because what the owner has to do is check those boxes and reconnect; listing every
// requirement would just make them do the subtraction themselves.
type ScopeShortfall struct {
	Operation string
	Needs     []string
}

// scopeShortfall — compares, operation by operation, "what this step needs ⊇ what was granted".
//
// An operation with no declared scope is skipped (that means "this step needs no extra
// permission"); one that's fully covered is also skipped. An empty result = this grant can do
// everything it declared.
func scopeShortfall(spec *openapi.Spec, granted []string) []ScopeShortfall {
	have := make(map[string]bool, len(granted))
	for _, g := range granted {
		have[g] = true
	}
	out := make([]ScopeShortfall, 0)
	for _, op := range spec.Operations() {
		missing := missingScopes(spec.ScopesFor(op.ID), have)
		if len(missing) > 0 {
			out = append(out, ScopeShortfall{Operation: op.ID, Needs: missing})
		}
	}
	return out
}

func missingScopes(need []string, have map[string]bool) []string {
	out := make([]string, 0, len(need))
	for _, n := range need {
		if !have[n] {
			out = append(out, n)
		}
	}
	return out
}

// DeriveCredentialForm — derive the credential form the owner has to fill in. An openapi
// connector derives it from the spec's securityScheme; a protocol connector (smtp/caldav) has
// no spec, so it derives from the built-in protocol's fixed fields (F-C-2: this used to run
// ParseSpec unconditionally → a protocol connector got a 400 "unsupported openapi version",
// and the configure form couldn't render at all).
func DeriveCredentialForm(m *Manifest) (CredentialForm, error) {
	if m.Kind == "protocol" {
		return protocolCredentialForm(m.Protocol)
	}
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return CredentialForm{}, fmt.Errorf(errConnectorWrap, m.ID, err)
	}
	f, ok := pickAuthForm(openapi.DeriveAuthForms(spec).Forms, m.AuthScheme)
	if !ok {
		return CredentialForm{}, fmt.Errorf(errConnectorWrap, m.ID, errNoUsableScheme)
	}
	form := credFormFromAuth(&f)
	form.Schemes = schemeNames(spec)
	return form, nil
}

// errUnknownProtocol — the manifest declares a protocol with no built-in runtime; the configure
// form can't be derived.
var errUnknownProtocol = errors.New("unknown protocol connector")

// protocolCredentialForm — the credential form for a built-in protocol connector. Field keys
// must match the JSON shape the save path parses (smtp: cmd/server smtpCredJSON; caldav:
// caldavCredJSON), otherwise filling in the form still can't get the values into the connector.
// AuthType uses the protocol name (the frontend renders the generic-field branch off it, not
// the oauth2/apiKey branch).
func protocolCredentialForm(protocol string) (CredentialForm, error) {
	switch protocol {
	case "smtp":
		return CredentialForm{
			AuthType: "smtp",
			Fields: []string{
				"host", "port", "username", "password", "from_address", "from_name", "tls",
			},
		}, nil
	case "caldav":
		return CredentialForm{
			AuthType: "caldav",
			Fields:   []string{"url", "username", "password"},
		}, nil
	default:
		return CredentialForm{}, fmt.Errorf("%w: %q", errUnknownProtocol, protocol)
	}
}

// pickAuthForm — pick the effective scheme form: use the owner's pick if made; otherwise use
// the sole scheme if there's only one; multiple schemes with none picked → none (ambiguous).
func pickAuthForm(forms []openapi.AuthSchemeForm, picked string) (openapi.AuthSchemeForm, bool) {
	if picked != "" {
		for i := range forms {
			if forms[i].Scheme == picked {
				return forms[i], true
			}
		}
		return openapi.AuthSchemeForm{}, false
	}
	if len(forms) == 1 {
		return forms[0], true
	}
	return openapi.AuthSchemeForm{}, false
}

// credFormFromAuth — narrow an AuthSchemeForm down to a CredentialForm: keep only the input
// fields the owner fills in (text/password); scope checkboxes go into Scopes; readonly fields
// (redirect_uri) don't go into fields (the frontend renders those separately).
func credFormFromAuth(f *openapi.AuthSchemeForm) CredentialForm {
	fields := make([]string, 0, len(f.Fields))
	var scopes []string
	for i := range f.Fields {
		switch f.Fields[i].Type {
		case "text", "password":
			fields = append(fields, f.Fields[i].Key)
		case "scopes":
			scopes = f.Fields[i].Scopes
		default:
			// readonly (redirect_uri) etc.: don't go into the owner-filled fields
		}
	}
	return CredentialForm{AuthType: f.Type, Fields: fields, Scopes: scopes}
}

// schemeNames — every securityScheme name the spec declares (sorted). Lets the owner pick when
// admin exposes multiple schemes.
func schemeNames(spec *openapi.Spec) []string {
	schemes := spec.SecuritySchemes()
	out := make([]string, 0, len(schemes))
	for name := range schemes {
		out = append(out, name)
	}
	slices.Sort(out)
	return out
}
