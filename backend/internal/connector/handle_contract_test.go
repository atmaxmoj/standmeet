// handle_contract_test.go —— connector 重构 · 句柄契约（connector-deps-tests.md §一
// handle-contract）。注入给插件/能力的「句柄」= 连接器对外暴露的接口（Connector 基面 +
// 品类契约 CalendarProxy/MailProxy）：只暴露调用法（Connected / FreeBusy / InsertEvent /
// DeleteEvent / Send），**没有任何掏凭据的 getter**。owner token/secret/密码只活在 connector
// 包内（解密、注入都是包内逻辑）。本测试盯住这些**导出接口**的 API surface，防有人后来加个
// Token() / Secret() / Credentials() 把凭据漏出连接器层。

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
	for m := range typ.Methods() { // 只遍历导出方法 —— 句柄对外面
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
