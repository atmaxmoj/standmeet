// credform.go —— 从 openapi spec 派生「凭据表单」：owner 该填哪些字段连这个连接器。
// **单一事实源**：字段/类型/scope 全从 openapi.DeriveAuthForms（authform）取，本文件只把它那份更全的
// AuthSchemeForm 收窄成 configure 表单要的 CredentialForm。摄入预览（authform）与配置表单（本文件）
// 曾各自枚举一份 auth 知识而漂移——apiKey 字段名（'key' vs scheme 名）、oidc 被当成 token——都是那样
// 漏出来的。收成一处后，加/改一个 auth 类型只在 authform 改一次。纯数据派生，不碰凭据本身。

package connector

import (
	"errors"
	"fmt"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// errNoUsableScheme —— 选中的 securityScheme 无对应可用表单（没这个名 / 多方案未选）。装配好的
// 连接器其方案必被 authform 支持，故此错实际不可达；留作显式兜底而非静默空表单。
var errNoUsableScheme = errors.New("no usable auth scheme for credential form")

// CredentialForm —— 一个连接器要 owner 填的凭据表单：认证类型 + 字段 key 列表 + oauth2 可勾选 scope
// + spec 声明的所有 securityScheme 名（多 scheme 让 owner 选）。
type CredentialForm struct {
	AuthType string
	Fields   []string
	Scopes   []string
	Schemes  []string
}

// DeriveCredentialForm —— 派生 owner 要填的凭据表单。openapi 连接器从 spec 的
// securityScheme 派生；protocol 连接器（smtp/caldav）没有 spec，从内置协议的固定字段
// 派生（F-C-2:之前无条件跑 ParseSpec → protocol 连接器 400 "unsupported openapi
// version"，配置表单渲染不出来）。
func DeriveCredentialForm(m *Manifest) (CredentialForm, error) {
	if m.Kind == "protocol" {
		return protocolCredentialForm(m.Protocol)
	}
	spec, err := openapi.ParseSpec(m.Spec)
	if err != nil {
		return CredentialForm{}, fmt.Errorf(errConnectorWrap, m.ID, err)
	}
	f, ok := pickAuthForm(openapi.DeriveAuthForms(spec).Forms, m.AuthScheme)
	if !ok {
		return CredentialForm{}, fmt.Errorf(errConnectorWrap, m.ID, errNoUsableScheme)
	}
	form := credFormFromAuth(&f)
	form.Schemes = schemeNames(spec)
	return form, nil
}

// errUnknownProtocol —— manifest 声明了没有内置 runtime 的 protocol；配置表单派生不出来。
var errUnknownProtocol = errors.New("unknown protocol connector")

// protocolCredentialForm —— 内置协议连接器的凭据表单。字段 key 必须跟保存路径解析的
// JSON 形状一致（smtp: cmd/server smtpCredJSON；caldav: caldavCredJSON），否则表单填了
// 也进不去连接器。AuthType 用 protocol 名（前端据此渲通用字段，非 oauth2/apiKey 分支）。
func protocolCredentialForm(protocol string) (CredentialForm, error) {
	switch protocol {
	case "smtp":
		return CredentialForm{
			AuthType: "smtp",
			Fields: []string{
				"host", "port", "username", "password", "from_address", "from_name", "tls",
			},
		}, nil
	case "caldav":
		return CredentialForm{
			AuthType: "caldav",
			Fields:   []string{"url", "username", "password"},
		}, nil
	default:
		return CredentialForm{}, fmt.Errorf("%w: %q", errUnknownProtocol, protocol)
	}
}

// pickAuthForm —— 选中生效的方案表单：owner 选了用选的；否则唯一一个用它；多方案未选 → 无（ambiguous）。
func pickAuthForm(forms []openapi.AuthSchemeForm, picked string) (openapi.AuthSchemeForm, bool) {
	if picked != "" {
		for i := range forms {
			if forms[i].Scheme == picked {
				return forms[i], true
			}
		}
		return openapi.AuthSchemeForm{}, false
	}
	if len(forms) == 1 {
		return forms[0], true
	}
	return openapi.AuthSchemeForm{}, false
}

// credFormFromAuth —— AuthSchemeForm 收窄成 CredentialForm：只留 owner 要填的输入字段（text/password）；
// scope 多选进 Scopes；readonly（redirect_uri）不进 fields（前端另渲）。
func credFormFromAuth(f *openapi.AuthSchemeForm) CredentialForm {
	fields := make([]string, 0, len(f.Fields))
	var scopes []string
	for i := range f.Fields {
		switch f.Fields[i].Type {
		case "text", "password":
			fields = append(fields, f.Fields[i].Key)
		case "scopes":
			scopes = f.Fields[i].Scopes
		default:
			// readonly（redirect_uri）等：不进 owner 要填的 fields
		}
	}
	return CredentialForm{AuthType: f.Type, Fields: fields, Scopes: scopes}
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
