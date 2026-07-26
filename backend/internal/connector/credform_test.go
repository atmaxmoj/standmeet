// credform_test.go —— DeriveCredentialForm 对 protocol 连接器的守卫（F-C-2）。
//
// 真机验证发现 GET /connectors/smtp/credential-form → 400
// "invalid_manifest: unsupported openapi version \"\"": DeriveCredentialForm
// 无条件跑 openapi.ParseSpec，但 protocol 连接器（smtp/caldav）根本没有 spec。
// 结果整个内建「mail」连接器的配置表单渲染不出来。之前 e2e 全绿 —— 因为没有一条
// spec 覆盖内建 protocol 连接器的 credential-form（都打的 openapi 连接器）。

package connector_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/stretchr/testify/require"
)

// F-C-2 —— protocol(smtp) 连接器必须能派生凭据表单（不跑 openapi 装配、不报错）。
// 字段 key 要跟保存路径（smtpCredJSON）对上，否则表单填了也进不去连接器。
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

// caldav 是另一个 protocol —— 同样必须出表单（url/username/password）。
func TestDeriveCredentialForm_CalDAVProtocol(t *testing.T) {
	t.Parallel()
	form, err := connector.DeriveCredentialForm(&connector.Manifest{
		ID: "caldav", Kind: "protocol", Protocol: "caldav", Category: "calendar",
	})
	require.NoError(t, err)
	require.Equal(t, "caldav", form.AuthType)
	require.Subset(t, form.Fields, []string{"url", "username", "password"})
}
