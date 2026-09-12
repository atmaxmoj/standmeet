// ingest.go — lifts openapi spec ingestion validation up onto the integration package surface
// (architecture: supplier routes go through integration, never touch the infra/openapi
// subpackage directly). A thin forward, unified onto the same 3.0 parser.

package integration

import "github.com/atmaxmoj/standmeet/internal/infra/openapi"

// MaxSpecBytes — how large a spec this instance accepts. **No longer a compile-time constant**:
// the owner can configure it via `SUPPLIER_SPEC_MAX_BYTES` (default 2 MiB, see
// openapi/ingest.go). This is still a thin forward — the value is produced in one place only.
var MaxSpecBytes = openapi.MaxSpecBytes

// AuthForms / AuthSchemeForm / AuthFieldForm — derived credential-form descriptions (aliases
// passing through the openapi types, so supplier routes can use them via integration
// without importing the openapi subpackage directly).
type AuthForms = openapi.AuthForms

// IngestVerdict — the ingestion validation result (owner-friendly): OK → Title + derived
// credential form; otherwise Reason is the rejection reason.
type IngestVerdict struct {
	Title  string
	Reason string
	Auth   AuthForms
	OK     bool
}

// ValidateIngestSpec — validate a spec pending ingestion + derive its credential form. Errors
// are converted into an owner-friendly verdict.
func ValidateIngestSpec(raw []byte) IngestVerdict {
	title, err := openapi.ValidateIngest(raw)
	if err != nil {
		return IngestVerdict{Reason: err.Error()}
	}
	spec, perr := openapi.ParseSpec(raw)
	if perr != nil {
		return IngestVerdict{Reason: "could not parse the spec"}
	}
	return IngestVerdict{OK: true, Title: title, Auth: openapi.DeriveAuthForms(spec)}
}
