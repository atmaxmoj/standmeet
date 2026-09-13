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

// caldav is no longer a protocol — it is a `block` (a Koishi plugin composing the http hand). Its
// form is derived from the block's declared config field keys (Source.Fields), not from a
// host-side protocol case, so the host names no caldav-specific form. AuthType "block" renders the
// generic-field branch, same as smtp/credential.
func TestDeriveCredentialForm_Block(t *testing.T) {
	t.Parallel()
	form, err := credform.DeriveCredentialForm(&credform.Source{
		ID: "caldav", Kind: "block", Fields: []string{"url", "username", "password"},
	})
	require.NoError(t, err)
	require.Equal(t, "block", form.AuthType)
	require.Equal(t, []string{"url", "username", "password"}, form.Fields,
		"a block's form is exactly its declared config field keys")
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
