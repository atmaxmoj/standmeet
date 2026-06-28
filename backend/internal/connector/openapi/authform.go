// authform.go —— #155 区 B：从 spec 的 securitySchemes 派生「凭据表单」描述（owner 该填哪些字段、
// 字段类型、scope 多选、apiKey 落 header/query、oauth2/oidc 要不要 dance、oidc discovery URL）。
// 前端通用渲染器据此渲表单，不每个连接器手写。纯数据派生（§4 认证表）。

package openapi

import (
	"slices"
	"strings"
)

// AuthFieldForm —— 表单里的一个字段。Type: text | password | readonly | scopes。
type AuthFieldForm struct {
	Key    string   `json:"key"`
	Type   string   `json:"type"`
	Scopes []string `json:"scopes,omitempty"`
}

// AuthSchemeForm —— 一个 securityScheme 派生出的表单。Scheme = spec 里的方案名（多方案选择器用）。
type AuthSchemeForm struct {
	Scheme       string          `json:"scheme"`
	Type         string          `json:"type"` // oauth2 | oidc | apikey | basic | bearer
	In           string          `json:"in,omitempty"`
	ParamName    string          `json:"param_name,omitempty"`
	DiscoveryURL string          `json:"discovery_url,omitempty"`
	Fields       []AuthFieldForm `json:"fields"`
	NeedsDance   bool            `json:"needs_dance"`
}

// AuthForms —— 一份 spec 的派生结果：若干可选方案；Note 非空 = 无可用/不支持的认证（owner 提示）。
type AuthForms struct {
	Note  string           `json:"note,omitempty"`
	Forms []AuthSchemeForm `json:"forms,omitempty"`
}

// DeriveAuthForms —— 遍历 spec 的 securitySchemes 派生表单。无方案 → no-auth note；全不支持 →
// unsupported note；否则按方案名排序返回（多方案前端给选择器）。
func DeriveAuthForms(spec *Spec) AuthForms {
	schemes := spec.SecuritySchemes()
	if len(schemes) == 0 {
		return AuthForms{Note: "no supported authentication scheme found in this spec"}
	}
	forms := make([]AuthSchemeForm, 0, len(schemes))
	unsupported := make([]string, 0)
	for _, name := range sortedKeys(schemes) {
		s := schemes[name]
		if f, ok := authSchemeForm(name, &s); ok {
			forms = append(forms, f)
		} else {
			unsupported = append(unsupported, s.Type)
		}
	}
	if len(forms) == 0 {
		note := "unsupported authentication type: " + strings.Join(unsupported, ", ")
		return AuthForms{Note: note}
	}
	return AuthForms{Forms: forms}
}

// sortedKeys —— securityScheme 名字排序（确定性的方案顺序，多方案选择器稳定）。
func sortedKeys(schemes map[string]SecurityScheme) []string {
	names := make([]string, 0, len(schemes))
	for name := range schemes {
		names = append(names, name)
	}
	slices.Sort(names)
	return names
}

// authSchemeForm —— 单个 securityScheme → 表单。oauth2/oidc 同形；其余下放 nonOAuthForm。
func authSchemeForm(name string, s *SecurityScheme) (AuthSchemeForm, bool) {
	switch s.Type {
	case "oauth2":
		return oauthForm(name, "oauth2", oauthScopes(s), ""), true
	case "openIdConnect":
		return oauthForm(name, "oidc", []string{}, s.OpenIDConnectURL), true
	default:
		return nonOAuthForm(name, s)
	}
}

// nonOAuthForm —— 非 oauth 方案：apiKey（key + header/query 位置）/ http（basic|bearer）。
func nonOAuthForm(name string, s *SecurityScheme) (AuthSchemeForm, bool) {
	switch s.Type {
	case "apiKey":
		return AuthSchemeForm{
			Scheme: name, Type: "apikey", In: s.In, ParamName: s.Name,
			Fields: []AuthFieldForm{{Key: "key", Type: "password"}},
		}, true
	case "http":
		return httpSchemeForm(name, s.Scheme), true
	default:
		return AuthSchemeForm{}, false
	}
}

// oauthForm —— oauth2 / oidc 同形：client_id + client_secret + scope 多选 + 只读 redirect_uri，需 dance。
func oauthForm(name, kind string, scopes []string, discovery string) AuthSchemeForm {
	fields := []AuthFieldForm{
		{Key: "client_id", Type: "text"},
		{Key: "client_secret", Type: "password"},
	}
	if len(scopes) > 0 {
		fields = append(fields, AuthFieldForm{Key: "scope", Type: "scopes", Scopes: scopes})
	}
	fields = append(fields, AuthFieldForm{Key: "redirect_uri", Type: "readonly"})
	return AuthSchemeForm{
		Scheme: name, Type: kind, DiscoveryURL: discovery, Fields: fields, NeedsDance: true,
	}
}

// httpSchemeForm —— http securityScheme：basic→username/password；其余（bearer）→单 token。
func httpSchemeForm(name, scheme string) AuthSchemeForm {
	if scheme == "basic" {
		return AuthSchemeForm{Scheme: name, Type: "basic", Fields: []AuthFieldForm{
			{Key: "username", Type: "text"}, {Key: "password", Type: "password"},
		}}
	}
	return AuthSchemeForm{Scheme: name, Type: "bearer", Fields: []AuthFieldForm{
		{Key: "token", Type: "password"},
	}}
}

// oauthScopes —— oauth2 authorizationCode flow 声明的所有 scope（排序，去 op 引用差异）。
func oauthScopes(s *SecurityScheme) []string {
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
