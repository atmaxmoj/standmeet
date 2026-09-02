// corpus_wire.go — the wire shapes for corpus retrieval ops, plus marshal fallbacks (#157).
// The socket handler (corpus_index_socket.go) always returns a JSON string; this file
// centralizes marshaling and its failure fallback.

package usecase

import "encoding/json"

func errJSON(msg string) string {
	out, err := json.Marshal(map[string]string{"error": msg})
	if err != nil {
		return `{"error":"marshal failed"}`
	}
	return string(out)
}

func marshalRows(rows []Row) string {
	out, err := json.Marshal(rows)
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(out)
}

// readResultWire — the corpus_read wire shape. id (stable identifier) + genre +
// body (markdown) + path (tree-derived address) + title; css_classes is the per-note
// presentation hook.
type readResultWire struct {
	// AssetURLs — the images/attachments on this piece of corpus, plus the addresses
	// resolved from references in the body.
	AssetURLs map[string]string `json:"asset_urls,omitempty"`
	ID        string            `json:"id"`
	Genre     string            `json:"genre"`
	Body      string            `json:"body"`
	Path      string            `json:"path"`
	// Slug — writings only. The public site addresses a writing by slug
	// (`/writings/<slug>`), while Path is its position in the tree (`writings/<slug>`).
	// Without it, a caller can only build the URL from Path, and that build 404s.
	Slug  string `json:"slug,omitempty"`
	Title string `json:"title"`
	// Lang / Languages — which language this body is in, and which other languages this
	// note can be read in. Languages must always be sent: otherwise the agent has no way
	// to know other languages exist, let alone choose one itself.
	// Single-language note: Lang is empty, Languages is an empty array.
	Lang         string      `json:"lang,omitempty"`
	Languages    []string    `json:"languages"`
	CSSClasses   []string    `json:"css_classes"`
	Assets       []AssetView `json:"assets,omitempty"`
	ShowAsSource bool        `json:"show_as_source"`
}

func marshalReadResult(r *readResultWire) string {
	if r.CSSClasses == nil {
		r.CSSClasses = []string{}
	}
	out, err := json.Marshal(r)
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(out)
}
