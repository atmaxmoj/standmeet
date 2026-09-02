// handle_contract_test.go — connector refactor · handle contract (connector-deps-tests.md §1
// handle-contract). The "handle" injected into plugins/capabilities = the interface a connector
// exposes externally (the Connector base surface + category contracts CalendarProxy/MailProxy):
// it exposes only call methods (Connected / FreeBusy / InsertEvent / DeleteEvent / Send), **no
// getter that extracts credentials at all**. Owner tokens/secrets/passwords live only inside
// the connector package (decryption and injection are both internal package logic). This test
// watches the API surface of these **exported interfaces**, guarding against someone later
// adding a Token() / Secret() / Credentials() that leaks credentials out of the connector layer.

package connector_test

import (
	"reflect"
	"regexp"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/stretchr/testify/require"
)

var credGetterRe = regexp.MustCompile(`(?i)token|secret|password|passwd|credential|apikey|api_key`)

func assertNoCredentialGetter(t *testing.T, typ reflect.Type) {
	t.Helper()
	for m := range typ.Methods() { // only iterate exported methods — the handle's external surface
		require.Falsef(t, credGetterRe.MatchString(m.Name),
			"%s exposes credential-ish method %q (creds stay in connector)", typ, m.Name)
	}
}

func TestHandleContract_NoCredentialGetter(t *testing.T) {
	t.Parallel()
	assertNoCredentialGetter(t, reflect.TypeFor[connector.Connector]())
	assertNoCredentialGetter(t, reflect.TypeFor[contract.CalendarProxy]())
	assertNoCredentialGetter(t, reflect.TypeFor[contract.MailProxy]())
}
