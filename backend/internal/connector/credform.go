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

// DeriveCredentialForm —— 解析 manifest 的 spec，按选中的 securityScheme 派生凭据表单。字段/类型/
// scope 全来自 authform（单一事实源）；本函数只挑中选中方案 + 收窄成 configure 表单形状。
func DeriveCredentialForm(m *Manifest) (CredentialForm, error) {
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
