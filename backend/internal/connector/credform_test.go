// credform_test.go — guard for DeriveCredentialForm against protocol connectors (F-C-2).
//
// Real-environment verification found GET /connectors/smtp/credential-form → 400
// "invalid_manifest: unsupported openapi version \"\"": DeriveCredentialForm unconditionally ran
// openapi.ParseSpec, but protocol connectors (smtp/caldav) have no spec at all. The result: the
// built-in "mail" connector's config form couldn't render at all. e2e was all green before this —
// because no spec covered credential-form for a built-in protocol connector (they all targeted
// openapi connectors).

package connector_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/stretchr/testify/require"
)

// F-C-2 — a protocol(smtp) connector must be able to derive a credential form (no openapi
// assembly, no error). Field keys must line up with the save path (smtpCredJSON), otherwise
// filling in the form still can't get the values into the connector.
func TestDeriveCredentialForm_SMTPProtocol(t *testing.T) {
	t.Parallel()
	form, err := connector.DeriveCredentialForm(&connector.Manifest{
		ID: "smtp", Kind: "protocol", Protocol: "smtp", Category: "mail",
	})
	require.NoError(t, err, "protocol connector must derive a form, not 400 on openapi parse")
	require.Equal(t, "smtp", form.AuthType)
	// keys mirror smtpCredJSON (host/port/username/password/from_address/from_name/tls).
	require.Subset(t, form.Fields,
		[]string{"host", "port", "username", "password", "from_address", "from_name"},
		"smtp form must expose the fields the connector reads on save")
}

// caldav is another protocol — it must also produce a form (url/username/password).
func TestDeriveCredentialForm_CalDAVProtocol(t *testing.T) {
	t.Parallel()
	form, err := connector.DeriveCredentialForm(&connector.Manifest{
		ID: "caldav", Kind: "protocol", Protocol: "caldav", Category: "calendar",
	})
	require.NoError(t, err)
	require.Equal(t, "caldav", form.AuthType)
	require.Subset(t, form.Fields, []string{"url", "username", "password"})
}
