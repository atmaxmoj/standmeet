// jsonwire.go —— the tool-result JSON fallback helper.
//
// A copy of the one in `plugin/mount`, and the third copy this seven-line function has
// had (it started in visitor_chat_tools.go). That is not a single source of truth being
// violated: there is no fact here, only a shape every tool return happens to share.
// Sharing it would mean a route package importing the mounting kernel to borrow four
// lines of json.Marshal.

package blockload

import "encoding/json"

// errJSON —— every tool return is a JSON string; the marshal-error fallback is
// centralized here to avoid scattered errcheck warnings.
func errJSON(msg string) string {
	out, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		return `{"error":"marshal failed"}`
	}
	return string(out)
}
