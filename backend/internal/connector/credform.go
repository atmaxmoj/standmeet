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
	form := formForScheme(effectiveSchemeName(spec, m.AuthScheme), &scheme)
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

// effectiveSchemeName —— 当前生效的 scheme 名：owner 选了用选的；否则唯一一个用它；多个未选 → 空。
func effectiveSchemeName(spec *openapi.Spec, picked string) string {
	if picked != "" {
		return picked
	}
	names := schemeNames(spec)
	if len(names) == 1 {
		return names[0]
	}
	return ""
}

// formForScheme —— securityScheme → 凭据表单（§4 认证表）。未知 type → 兜底单 token。apiKey 的字段
// 用 scheme 名（owner UI 上按那个名字填），无名时退回通用 "key"。
func formForScheme(name string, s *openapi.SecurityScheme) CredentialForm {
	switch s.Type {
	case "oauth2":
		return CredentialForm{
			AuthType: "oauth2", Fields: []string{"client_id", "client_secret"},
			Scopes: oauth2ScopeKeys(s),
		}
	case "apiKey":
		return CredentialForm{AuthType: "apikey", Fields: []string{apiKeyField(name)}}
	case "http":
		return httpForm(s.Scheme)
	default:
		return CredentialForm{AuthType: "token", Fields: []string{"token"}}
	}
}

// apiKeyField —— apiKey 字段 key（用 scheme 名；无名退回 "key"）。
func apiKeyField(name string) string {
	if name == "" {
		return "key"
	}
	return name
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
