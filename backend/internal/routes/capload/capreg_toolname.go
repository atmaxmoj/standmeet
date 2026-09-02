// capreg_toolname.go —— LLM tool name normalization, shared by capabilities that
// "aggregate external tools into LLM tools" (ext-mcp's ext_<server>_<tool>, mcp-app's
// <plugin>_<tool>). skill now uses static names (skill_use / skill_run_script), and
// doesn't go through this.

package capload

import "regexp"

// maxToolNameLen —— a safe truncation length near the Anthropic tool name limit.
const maxToolNameLen = 64

// toolNameSanitizeRe —— replaces anything outside [a-zA-Z0-9_-] with '_' (including '.').
var toolNameSanitizeRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

// sanitizeToolName —— illegal characters → '_', truncated to maxToolNameLen if too long.
func sanitizeToolName(raw string) string {
	clean := toolNameSanitizeRe.ReplaceAllString(raw, "_")
	if len(clean) > maxToolNameLen {
		clean = clean[:maxToolNameLen]
	}
	return clean
}
