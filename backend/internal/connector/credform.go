// credform.go —— 从 openapi spec 的 securityScheme 派生「凭据表单」：owner 该填哪些字段连这个
// 连接器。admin UI 据此渲染表单；编辑 spec 换认证 type 后表单跟着重派生（#161/§4 认证表）。
// 纯数据派生，不碰凭据本身。

package connector

import (
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/connector/openapi"
)

// CredentialForm —— 一个连接器要 owner 填的凭据表单：认证类型 + 字段 key 列表。
type CredentialForm struct {
	AuthType string
	Fields   []string
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
	return formForScheme(&scheme), nil
}

// formForScheme —— securityScheme → 凭据表单（§4 认证表）。未知 type → 兜底单 token。
func formForScheme(s *openapi.SecurityScheme) CredentialForm {
	switch s.Type {
	case "oauth2":
		return CredentialForm{AuthType: "oauth2", Fields: []string{"client_id", "client_secret"}}
	case "apiKey":
		return CredentialForm{AuthType: "apikey", Fields: []string{"key"}}
	case "http":
		return httpForm(s.Scheme)
	default:
		return CredentialForm{AuthType: "token", Fields: []string{"token"}}
	}
}

// httpForm —— http securityScheme 按 scheme 子型派生（bearer→token；basic→user/pass）。
func httpForm(scheme string) CredentialForm {
	if scheme == "basic" {
		return CredentialForm{AuthType: "basic", Fields: []string{"username", "password"}}
	}
	return CredentialForm{AuthType: "bearer", Fields: []string{"token"}}
}
