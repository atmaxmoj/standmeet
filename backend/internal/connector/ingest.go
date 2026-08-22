// ingest.go —— 把 openapi spec 摄入校验提到 connector 包面（arch：connectorsvc/adminroutes 经
// connector 用，不直接碰 connector/openapi 子包）。薄转发，归一到同一个 3.0 parser。

package connector

import "github.com/atmaxmoj/standmeet/internal/connector/openapi"

// MaxSpecBytes —— 这台实例收多大的 spec。**不再是编译期常量**：owner 用
// `CONNECTOR_SPEC_MAX_BYTES` 配得动（默认 2 MiB，见 openapi/ingest.go）。
// 这里仍然是薄转发 —— 值只有一处产生。
var MaxSpecBytes = openapi.MaxSpecBytes

// AuthForms / AuthSchemeForm / AuthFieldForm —— 派生的凭据表单描述（别名透传 openapi 类型，让
// connectorsvc/adminroutes 经 connector 用，不直接 import openapi 子包）。
type AuthForms = openapi.AuthForms

// IngestVerdict —— 摄入校验结果（owner 友好）：OK → Title + 派生凭据表单；否则 Reason 是拒绝理由。
type IngestVerdict struct {
	Title  string
	Reason string
	Auth   AuthForms
	OK     bool
}

// ValidateIngestSpec —— 校验一份待摄入 spec + 派生凭据表单。错误转成 owner 友好 verdict。
func ValidateIngestSpec(raw []byte) IngestVerdict {
	title, err := openapi.ValidateIngest(raw)
	if err != nil {
		return IngestVerdict{Reason: err.Error()}
	}
	spec, perr := openapi.ParseSpec(raw)
	if perr != nil {
		return IngestVerdict{Reason: "could not parse the spec"}
	}
	return IngestVerdict{OK: true, Title: title, Auth: openapi.DeriveAuthForms(spec)}
}
