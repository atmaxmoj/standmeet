// credform.go —— 从 openapi spec 的 securityScheme 派生「凭据表单」：owner 该填哪些字段连这个
// 连接器。admin UI 据此渲染表单；编辑 spec 换认证 type 后表单跟着重派生（#161/§4 认证表）。
// 纯数据派生，不碰凭据本身。

package connector

import (
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// CredentialForm —— 一个连接器要 owner 填的凭据表单：认证类型 + 字段 key 列表 + oauth2 可勾选 scope
// + spec 声明的所有 securityScheme 名（多 scheme 让 owner 选）。
type CredentialForm struct {
	AuthType string
	Fields   []string
	Scopes   []string
	Schemes  []string
}

// DeriveCredentialForm —— 解析 manifest 的 spec，按选中的 securityScheme 派生凭据表单。
// oauth2 → client_id/client_secret；apiKey/bearer → 单 token；basic → username/password。
func DeriveCredentialForm(m *Manifest) (CredentialForm, error) {
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return CredentialForm{}, fmt.Errorf(errConnectorWrap, m.ID, err)
	}
	scheme, serr := pickScheme(spec, m.AuthScheme)
	if serr != nil {
		return CredentialForm{}, fmt.Errorf(errConnectorWrap, m.ID, serr)
	}
	form := formForScheme(&scheme)
	form.Schemes = schemeNames(spec)
	return form, nil
}

// schemeNames —— spec 声明的所有 securityScheme 名（排序）。admin 多 scheme 时让 owner 选。
func schemeNames(spec *openapi.Spec) []string {
	schemes := spec.SecuritySchemes()
	out := make([]string, 0, len(schemes))
	for name := range schemes {
		out = append(out, name)
	}
	slices.Sort(out)
	return out
}

// formForScheme —— securityScheme → 凭据表单（§4 认证表）。未知 type → 兜底单 token。
// apiKey 的存储字段恒为 "key"：注入器 apiKeyInject 读的就是 creds["key"]（json:"key" 写死），
// authform 摄入预览也给 "key"——三处必须一致，否则自定义命名的 scheme（如 "sendgrid"）会让 owner
// 填错字段、注入器读到空 key → 静默 401。scheme 名/位置（header X-Api-Key / query）是 HTTP 落点，
// 由注入器从 scheme.In/scheme.Name 取，跟存储字段名正交。
func formForScheme(s *openapi.SecurityScheme) CredentialForm {
	switch s.Type {
	case "oauth2":
		return CredentialForm{
			AuthType: "oauth2", Fields: []string{"client_id", "client_secret"},
			Scopes: oauth2ScopeKeys(s),
		}
	case "apiKey":
		return CredentialForm{AuthType: "apikey", Fields: []string{"key"}}
	case "http":
		return httpForm(s.Scheme)
	default:
		return CredentialForm{AuthType: "token", Fields: []string{"token"}}
	}
}

// oauth2ScopeKeys —— oauth2 authorizationCode flow 声明的可勾选 scope（排序，UI 多选 + dance 子集）。
func oauth2ScopeKeys(s *openapi.SecurityScheme) []string {
	if s.Flows.AuthorizationCode == nil {
		return []string{}
	}
	out := make([]string, 0, len(s.Flows.AuthorizationCode.Scopes))
	for scope := range s.Flows.AuthorizationCode.Scopes {
		out = append(out, scope)
	}
	slices.Sort(out)
	return out
}

// httpForm —— http securityScheme 按 scheme 子型派生（bearer→token；basic→user/pass）。
func httpForm(scheme string) CredentialForm {
	if scheme == "basic" {
		return CredentialForm{AuthType: "basic", Fields: []string{"username", "password"}}
	}
	return CredentialForm{AuthType: "bearer", Fields: []string{"token"}}
}
