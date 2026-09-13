// credform_test.go — guard for DeriveCredentialForm against protocol suppliers (F-C-2).
//
// Real-environment verification found GET /suppliers/smtp/credential-form → 400
// "invalid_manifest: unsupported openapi version \"\"": DeriveCredentialForm unconditionally ran
// openapi.ParseSpec, but protocol suppliers (smtp/caldav) have no spec at all. The result: the
// built-in "mail" supplier's config form couldn't render at all. e2e was all green before this —
// because no spec covered credential-form for a built-in protocol supplier (they all targeted
// openapi suppliers).

package credform_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/credform"
	"github.com/stretchr/testify/require"
)

// F-C-2 — a protocol(smtp) supplier must be able to derive a credential form (no openapi
// assembly, no error). Field keys must line up with the save path (smtpCredJSON), otherwise
// filling in the form still can't get the values into the supplier.
func TestDeriveCredentialForm_SMTPProtocol(t *testing.T) {
	t.Parallel()
	form, err := credform.DeriveCredentialForm(&credform.Source{
		ID: "smtp", Kind: "protocol", Protocol: "smtp",
	})
	require.NoError(t, err, "protocol supplier must derive a form, not 400 on openapi parse")
	require.Equal(t, "smtp", form.AuthType)
	// keys mirror smtpCredJSON (host/port/username/password/from_address/from_name/tls).
	require.Subset(t, form.Fields,
		[]string{"host", "port", "username", "password", "from_address", "from_name"},
		"smtp form must expose the fields the supplier reads on save")
}

// caldav is another protocol — it must also produce a form (url/username/password).
func TestDeriveCredentialForm_CalDAVProtocol(t *testing.T) {
	t.Parallel()
	form, err := credform.DeriveCredentialForm(&credform.Source{
		ID: "caldav", Kind: "protocol", Protocol: "caldav",
	})
	require.NoError(t, err)
	require.Equal(t, "caldav", form.AuthType)
	require.Subset(t, form.Fields, []string{"url", "username", "password"})
}

// A credential-only supplier (kind=credential — where telegram lives now, no longer a host
// protocol) asks for a single opaque secret. The field key must be "token" — that's what
// /internal/im/config reads back for the im-bridge — and the host names no specific block.
func TestDeriveCredentialForm_Credential(t *testing.T) {
	t.Parallel()
	form, err := credform.DeriveCredentialForm(&credform.Source{
		ID: "up-telegram", Kind: "credential",
	})
	require.NoError(t, err)
	require.Equal(t, "credential", form.AuthType)
	require.Equal(t, []string{"token"}, form.Fields)
}
