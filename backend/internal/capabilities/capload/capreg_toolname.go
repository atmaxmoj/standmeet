// capreg_toolname.go —— LLM tool name 规范化，给「聚合外部工具成 LLM tool」的
// capability 共用（ext-mcp 的 ext_<server>_<tool>、mcp-app 的 <plugin>_<tool>）。
// skill 现在用静态名（skill_use / skill_run_script），不走这条。

package capload

import "regexp"

// maxToolNameLen —— Anthropic tool name 上限附近的安全截断长度。
const maxToolNameLen = 64

// toolNameSanitizeRe —— 非 [a-zA-Z0-9_-] 一律换 '_'（含 '.'）。
var toolNameSanitizeRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

// sanitizeToolName —— 非法字符 → '_'，超长截到 maxToolNameLen。
func sanitizeToolName(raw string) string {
	clean := toolNameSanitizeRe.ReplaceAllString(raw, "_")
	if len(clean) > maxToolNameLen {
		clean = clean[:maxToolNameLen]
	}
	return clean
}
