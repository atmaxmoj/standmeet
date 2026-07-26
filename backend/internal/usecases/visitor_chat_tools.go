// visitor_chat_tools.go —— 通用 tool-result JSON 兜底 helper。corpus wire 形与检索 op
// 已随 #157/domain-modules 归 corpus(uc_corpus_wire.go / uc_corpus_index_*.go);此处只
// 剩 capreg glue(ext_mcp / mcp_app / skill_runner)共用的 errJSON。

package usecases

import "encoding/json"

// errJSON —— tool 返回都是 JSON string;集中 marshal 错误兜底,避免散落 errcheck 告警。
func errJSON(msg string) string {
	out, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		return `{"error":"marshal failed"}`
	}
	return string(out)
}
