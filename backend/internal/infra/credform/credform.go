// credform.go — derives the "credential form" from an openapi spec: which fields the owner
// must fill in to connect this supplier.
// **Single source of truth**: fields/types/scopes all come from openapi.DeriveAuthForms
// (authform); this file only narrows its richer AuthSchemeForm down to the CredentialForm the
// configure form needs. Ingestion preview (authform) and the configure form (this file) used to
// each enumerate their own copy of auth knowledge and drift apart — the apiKey field name
// ('key' vs the scheme name), oidc being treated as token — both leaked from exactly that.
// Once collapsed to one place, adding/changing an auth type only touches authform once. Pure
// data derivation; never touches the credentials themselves.

package credform

import (
	"errors"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/infra/openapi"
)

// credentialTokenField —— the single field a credential-only supplier asks for: one opaque
// secret. Read back by its consumer (im-bridge reads `credentials_enc.token`, boot_im.go).
const credentialTokenField = "token"

// errNoUsableScheme —— the chosen securityScheme has no usable form (no such name / multiple
// schemes and none picked). An assembled supplier's scheme is always backed by authform, so
// this error is actually unreachable; kept as an explicit fallback rather than a silent empty
// form.
var errNoUsableScheme = errors.New("no usable auth scheme for credential form")

// CredentialForm — the credential form a supplier asks the owner to fill in: auth type + list
// of field keys + oauth2 checkable scopes + every securityScheme name the spec declares (lets
// the owner pick among multiple schemes).
type CredentialForm struct {
	AuthType string
	Fields   []string
	Scopes   []string
	Schemes  []string
	// Granted — the scope this connection **was actually granted at the time**. This is a
	// different thing from Scopes: Scopes is what this supplier **supports** (derived from
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

// ScopeShortfallFor — compares, operation by operation, "what this step needs ⊇ what was granted".
//
// An operation with no declared scope is skipped (that means "this step needs no extra
// permission"); one that's fully covered is also skipped. An empty result = this grant can do
// everything it declared.
// ScopeShortfallFor — exported because the admin layer answers this question for the
// owner's card. It was unexported while the caller sat in the same package as the
// supplier axis; the axis is gone and the caller is a route now.
func ScopeShortfallFor(spec *openapi.Spec, granted []string) []ScopeShortfall {
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

// Source — the four things deriving a form actually needs.
//
// It used to take a whole `adapters.Manifest`, which made this library import the
// axis it was supposed to be independent of. A library that names a domain type is
// not a library; it is that domain, filed elsewhere. Four fields is also the honest
// statement of the dependency — the manifest carries a dozen more that this never
// read.
//
// Field order follows pointer width — enforced by govet fieldalignment.
type Source struct {
	ID         string
	Kind       string
	Protocol   string
	AuthScheme string
	Spec       []byte
	// Fields — for a `block` supplier, the owner-connect field keys taken from the block's
	// declared `config:`. The form is derived from these, so the host names no block form.
	Fields []string
}

// DeriveCredentialForm — derive the credential form the owner has to fill in. An openapi
// supplier derives it from the spec's securityScheme; a block supplier (caldav/smtp) has no spec,
// so it derives from the block's declared `config:` fields (F-C-2: this used to run ParseSpec
// unconditionally → a spec-less supplier got a 400 "unsupported openapi version", and the
// configure form couldn't render at all).
func DeriveCredentialForm(m *Source) (CredentialForm, error) {
	switch m.Kind {
	case "credential":
		// A credential-only supplier holds one opaque secret (a bot token, a webhook secret) and
		// does nothing itself — some other service consumes it (the `im` seam's token, read by
		// im-bridge). One generic field, and the host names no specific block: this is where the
		// telegram case used to live (`case "telegram"` → {token}). AuthType "credential" renders
		// the frontend's generic-field branch, same as the protocol names did.
		return CredentialForm{AuthType: "credential", Fields: []string{credentialTokenField}}, nil
	case "block":
		// A block that supplies a seam (CalDAV for calendar, SMTP for mail). The owner-connect
		// fields come from the block's declared `config:` (Source.Fields), so the host names no
		// block-specific form. AuthType "block" renders the generic-field branch, like credential.
		return CredentialForm{AuthType: "block", Fields: m.Fields}, nil
	default:
		return openapiCredentialForm(m)
	}
}

// openapiCredentialForm — derive the form for an openapi supplier from its spec's securityScheme.
func openapiCredentialForm(m *Source) (CredentialForm, error) {
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return CredentialForm{}, fmt.Errorf(errBlockWrap, m.ID, err)
	}
	f, ok := pickAuthForm(openapi.DeriveAuthForms(spec).Forms, m.AuthScheme)
	if !ok {
		return CredentialForm{}, fmt.Errorf(errBlockWrap, m.ID, errNoUsableScheme)
	}
	form := credFormFromAuth(&f)
	form.Schemes = schemeNames(spec)
	return form, nil
}

// errBlockWrap — the shared prefix for form-derivation errors (carries the block id).
const errBlockWrap = "block %q: %w"

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
