// credform.go — boundary types for the credential form and uploaded content. CredentialForm
// directly aliases the connector layer's type of the same name: the shape is already 1:1
// (derivation logic lives in DeriveCredentialForm), and hand-copying it would only breed "added
// a field in one place, missed the other" — exactly the soil the apiKey-field bug grew in. The
// alias lets routes still only import connectorsvc (never touching connector), while sparing
// the field copy. Un-alias it if the shapes ever genuinely diverge.

package connector

// CredentialForm — the credential form a connector asks the owner to fill in (auth type +
// field keys + oauth2 scopes + scheme list).

// UploadedSpec — the content of an uploaded/edited connector (spec + JSONata binding + the
// selected authScheme + whether raw ops are exposed as agent tools).
//
// BaseURL — a base URL the owner typed in by hand. Real vendor docs often ship without a usable
// `servers` (Cal.com v2 writes an explicit `"servers": []`), and the owner shouldn't have to
// hand-edit the vendor's file (F-C-22). It's merged into Spec right at the Create/Update entry
// point, and **never passed downstream**: the spec that gets stored already has servers in it,
// so runtime, outbound validation, and credential-form derivation all only ever see one plain
// spec.
// URL — when the spec was "fetched from a URL", the owner has **no body in hand** — the body
// only existed during that one backend fetch (F-C-25: the panel showed a candidate off of it,
// but assembly then sent an empty spec). So on create/edit the source URL is sent along too,
// and this layer fetches it again: the fetch already carries the outbound guard, and it avoids
// shipping a 1.47 MB vendor document to the browser and back.
// When Spec is non-empty it's authoritative; URL is only the source when there's no body.
type UploadedSpec struct {
	AuthScheme         string
	BaseURL            string
	URL                string
	Spec               []byte
	Binding            []byte
	ExposeAsAgentTools bool
}
