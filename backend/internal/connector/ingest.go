// ingest.go —— 把 openapi spec 摄入校验提到 connector 包面（arch：connectorsvc/adminroutes 经
// connector 用，不直接碰 connector/openapi 子包）。薄转发，归一到同一个 3.0 parser。

package connector

import "github.com/atmaxmoj/standmeet/internal/connector/openapi"

// MaxSpecBytes —— 摄入 spec 的尺寸上限（前后端共用一个数）。
const MaxSpecBytes = openapi.MaxSpecBytes

// IngestVerdict —— 摄入校验结果（owner 友好）：OK → Title；否则 Reason 是人类可读拒绝理由。
type IngestVerdict struct {
	Title  string
	Reason string
	OK     bool
}

// ValidateIngestSpec —— 校验一份待摄入 spec。错误转成 owner 友好 verdict（不外泄 Go error）。
func ValidateIngestSpec(raw []byte) IngestVerdict {
	title, err := openapi.ValidateIngest(raw)
	if err != nil {
		return IngestVerdict{Reason: err.Error()}
	}
	return IngestVerdict{OK: true, Title: title}
}
