// jsonwire.go —— the tool-result JSON fallback helper for block-mount glue.
// Originally in visitor_chat_tools.go (moved to conversation along with the visitor
// cluster); the mount glue still needs it, so a copy is kept here.

package mount

import "encoding/json"

// errJSON —— every tool return is a JSON string; the marshal-error fallback is centralized
// here to avoid scattered errcheck warnings.
func errJSON(msg string) string {
	out, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		return `{"error":"marshal failed"}`
	}
	return string(out)
}
