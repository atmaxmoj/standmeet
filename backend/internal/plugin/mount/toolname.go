// toolname.go —— LLM tool name normalization, shared by blocks that
// "aggregate external tools into LLM tools" (ext-mcp's ext_<server>_<tool>, mcp-app's
// <plugin>_<tool>). skill now uses static names (skill_use / skill_run_script), and
// doesn't go through this.

package mount

import "regexp"

// maxToolNameLen —— a safe truncation length near the Anthropic tool name limit.
const maxToolNameLen = 64

// toolNameSanitizeRe —— replaces anything outside [a-zA-Z0-9_-] with '_' (including '.').
var toolNameSanitizeRe = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

// SanitizeToolName —— illegal characters → '_', truncated to maxToolNameLen if too long.
//
// Exported because the ext-mcp loader composes its names the same way, and it lives in
// routes/blockload (producing that fiber needs domain data, so it cannot sit in the substrate).
// One rule, one place: two copies would let ext_ and mcp-app names truncate differently, and a
// name that truncates differently is a tool the grant no longer matches.
func SanitizeToolName(raw string) string {
	clean := toolNameSanitizeRe.ReplaceAllString(raw, "_")
	if len(clean) > maxToolNameLen {
		clean = clean[:maxToolNameLen]
	}
	return clean
}
