// handle_contract_test.go —— connector 重构 · 句柄契约（connector-deps-tests.md §一
// handle-contract）。注入给插件/能力的「句柄」= connector proxy：只暴露调用法
// （Connected / FreeBusy / InsertEvent / DeleteEvent / Send），**没有任何掏凭据的
// getter**。owner token/secret/密码只活在 connector 包内（解密 token 的 freshToken
// 是未导出方法，不在句柄面上）。本测试盯住 proxy 的导出 API surface，防有人后来加个
// Token() / Secret() / Credentials() 把凭据漏出连接器层。
package connector_test

import (
	"reflect"
	"regexp"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/stretchr/testify/require"
)

var credGetterRe = regexp.MustCompile(`(?i)token|secret|password|passwd|credential|apikey|api_key`)

func assertNoCredentialGetter(t *testing.T, typ reflect.Type) {
	t.Helper()
	for i := 0; i < typ.NumMethod(); i++ {
		name := typ.Method(i).Name // NumMethod 只数导出方法 —— 句柄对外面
		require.Falsef(t, credGetterRe.MatchString(name),
			"%s exposes credential-ish method %q; creds must never leave the connector layer", typ, name)
	}
}

func TestHandleContract_NoCredentialGetter(t *testing.T) {
	t.Parallel()
	assertNoCredentialGetter(t, reflect.TypeOf((*connector.CalendarProxy)(nil)))
	assertNoCredentialGetter(t, reflect.TypeOf((*connector.MailProxy)(nil)))
}
