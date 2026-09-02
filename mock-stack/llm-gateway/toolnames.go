// toolnames.go —— the stand-in enforces tool-name rules by the same rule the real
// provider does.
//
// In the real world, both Anthropic and OpenAI restrict `tools[].name` to
// `^[a-zA-Z0-9_-]+$`, and **reject the whole array together** — one bad name and none of
// the turn's tools reach the model. This stand-in used to accept any name, so whether the
// names the product sends out are valid was never exercised once across the whole e2e
// suite ([[stand-in-is-politer-than-reality]]).
//
// The 400's wording is copied verbatim from the real provider's, so the red state's logs
// match what a real environment would show.
package main

import (
	"fmt"
	"net/http"
	"regexp"
)

var toolNameOK = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// rejectBadToolName —— an invalid tool name → write a 400 and return true (this turn stops here).
func rejectBadToolName(w http.ResponseWriter, req *MessagesReq) bool {
	for i := range req.Tools {
		if toolNameOK.MatchString(req.Tools[i].Name) {
			continue
		}
		http.Error(w, fmt.Sprintf(
			`{"error":{"type":"invalid_request_error","message":`+
				`"Invalid 'tools[%d].function.name': string does not match pattern. `+
				`Expected a string that matches the pattern '^[a-zA-Z0-9_-]+$'."}}`, i),
			http.StatusBadRequest)
		return true
	}
	return false
}
