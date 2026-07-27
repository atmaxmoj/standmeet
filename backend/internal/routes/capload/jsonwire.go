// jsonwire.go —— capreg capability glue 的 tool-result JSON 兜底 helper。原在
// visitor_chat_tools.go(随 visitor cluster 归 conversation);capreg glue 仍需,留一份。

package capload

import "encoding/json"

// errJSON —— tool 返回都是 JSON string;集中 marshal 错误兜底,避免散落 errcheck 告警。
func errJSON(msg string) string {
	out, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		return `{"error":"marshal failed"}`
	}
	return string(out)
}
