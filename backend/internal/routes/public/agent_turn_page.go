// agent_turn_page.go —— the page a chat turn is asked on. A turn from a live microsite carries
// doc_context {genre: "microsite", path: <slug>}; the agent gets that page's published text
// (PrerenderedText), read from the server's build, never from what the browser sent.

package public

import (
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/conversation/inference"
)

// pageTextForTurn —— the microsite's published text when the turn is asked on one; "" otherwise.
// A failure (the page was taken down, the build is unreadable) is logged and the turn runs
// without page text: the page is context, not a precondition.
func pageTextForTurn(r *http.Request, h *Handlers, doc *inference.AgentDocContext) string {
	if !onMicrosite(doc) {
		return ""
	}
	text, err := h.MicrositeText(r.Context(), doc.Path)
	if err != nil {
		h.Log.Warn("microsite page text", "slug", doc.Path, logErr, err)
		return ""
	}
	return text
}

func onMicrosite(doc *inference.AgentDocContext) bool {
	return doc != nil && doc.Genre == inference.DocGenreMicrosite
}

// pageOfTurn —— the microsite slug the turn is asked on, "" elsewhere. Page-scoped blocks act on
// it; their host op checks the session may open that page, so a forged slug reaches nothing.
func pageOfTurn(doc *inference.AgentDocContext) string {
	if !onMicrosite(doc) {
		return ""
	}
	return doc.Path
}
