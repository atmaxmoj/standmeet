// corpus.go — admin's corpus facade: list / detail / create / update / delete / promote,
// with genre carried as a path parameter.
//
// All capability is taken through the outbound convergence point (declared in
// internal/corpus/ops); this layer keeps only the REST shape: genre in the path, id in
// the path, everything else in the body, and whether a success returns 200, 201, or 204.
//
// The tree view and page view (/tree, /page) are browsing shapes **unique to the panel**
// and don't go through the convergence point: they return tree nodes, not "one corpus
// entry".

package admin

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CorpusDeps — dependencies for the admin corpus handlers.
//
// Face — corpus capability is taken through the convergence point. Corpus is only kept
// for the tree/page views, the two panel-unique views that still connect directly.
type CorpusDeps struct {
	Corpus corpus.Deps
	Face   *dispatcher.Face
}

const (
	defaultCorpusLimit = 50
	maxCorpusLimit     = 200
	paramGenre         = "genre"
	paramEntryID       = "id"
	paramAssetID       = "asset_id"
)

// MountCorpus mounts corpus's list + create routes: genre is a path parameter (merging
// the original three URL sets — /raw, /wiki, /output — since genre was always a
// parameter, and shouldn't have been split into different endpoints).
func (h *Handlers) MountCorpus(r chi.Router) {
	face := h.Corpus.Face
	r.Get("/corpus/{genre}", h.dispatchOp(face, "corpus.list", corpusListArgs, jsonOK))
	r.Post("/corpus/{genre}", h.dispatchOp(face, "corpus.create", corpusBodyArgs, jsonCreated))
	// search — finds an entry by content. The list only gives the latest page, while an
	// owner's corpus runs to thousands of entries: "open my good-regulator-theorem entry"
	// used to be impossible on this facade (F-L-39).
	r.Get("/corpus/{genre}/search", h.dispatchOp(face, "corpus.search", corpusSearchArgs, jsonOK))
	r.Get("/corpus/{genre}/tree", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.treeRaw(), "wiki": h.treeWiki(), "output": h.treeOutput(),
		"subjectivity": h.treeSubjectivity(),
	}))
	r.Get("/corpus/{genre}/page", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.pageRaw(), "wiki": h.pageWiki(), "output": h.pageOutput(),
	}))
	// tags — every tag this genre has ever used (corpus-wide). The panel's tag row reads
	// this.
	r.Get("/corpus/{genre}/tags", h.byGenre(map[string]http.HandlerFunc{
		"wiki": h.tagsWiki(),
	}))
	// check-i18n — read-only (it's a POST because the payload goes in the body, not
	// because it changes anything). The panel's editor calls this once before saving, and
	// gets back the same diagnostics the MCP write entrypoint would reject on.
	r.Post("/corpus/check-i18n", h.dispatchOp(face, "corpus.check_i18n", bodyArgs, jsonOK))
}

// byGenre — the genre dispatch the tree/page routes still use: the URL's {genre} picks
// the matching handler. An unknown genre, or one this view doesn't support, → 404
// unknown_genre.
func (h *Handlers) byGenre(m map[string]http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if handler, ok := m[chi.URLParam(r, paramGenre)]; ok {
			handler(w, r)
			return
		}
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "unknown_genre", Message: "unknown corpus genre",
		})
	}
}

// corpusListArgs — genre in the path, limit in the query. The convergence point side only
// accepts one flat args shape.
//
// If limit fails to parse it's simply dropped and the domain picks the default —
// ?limit=abc isn't an error, it's "unstated".
func corpusListArgs(r *http.Request) (json.RawMessage, error) {
	fields := map[string]json.RawMessage{
		paramGenre: quoteJSON(chi.URLParam(r, paramGenre)),
	}
	addPositiveInts(fields, r.URL.Query(), "limit")
	return marshalArgs(fields)
}

// corpusSearchArgs — genre in the path, the query term and pagination in the query
// string. An empty `?q=` means the domain reports a missing parameter; this facade
// doesn't fabricate an empty search for it — a search with no term given and a search
// that found nothing shouldn't come back looking like the same answer.
func corpusSearchArgs(r *http.Request) (json.RawMessage, error) {
	fields := map[string]json.RawMessage{
		paramGenre: quoteJSON(chi.URLParam(r, paramGenre)),
		"query":    quoteJSON(r.URL.Query().Get("q")),
	}
	addPositiveInts(fields, r.URL.Query(), "limit", "offset")
	return marshalArgs(fields)
}

// addPositiveInts — the handful of optional positive integers on the query string;
// includes each one if present.
//
// Extracted because `check-routes-cyclo` is right about this: **a branch means business
// logic, a facade should only declare and call**. The "?limit=abc isn't an error, it's
// unstated" judgment used to be copied once per route — copying it a second time was the
// signal to extract it.
func addPositiveInts(fields map[string]json.RawMessage, q url.Values, names ...string) {
	for _, n := range names {
		if raw, ok := positiveInt(q, n); ok {
			fields[n] = raw
		}
	}
}

func positiveInt(q url.Values, name string) (json.RawMessage, bool) {
	v, err := strconv.Atoi(q.Get(name))
	if err != nil {
		return nil, false
	}
	if v <= 0 {
		return nil, false
	}
	return json.RawMessage(strconv.Itoa(v)), true
}

// corpusBodyArgs — the body's fields + genre from the path.
func corpusBodyArgs(r *http.Request) (json.RawMessage, error) {
	fields, err := decodeBodyFields(r)
	if err != nil {
		return nil, err
	}
	fields[paramGenre] = quoteJSON(chi.URLParam(r, paramGenre))
	return marshalArgs(fields)
}

// corpusEntryArgs — the body + genre and id from the path (for update).
func corpusEntryArgs(r *http.Request) (json.RawMessage, error) {
	fields, err := decodeBodyFields(r)
	if err != nil {
		return nil, err
	}
	fields[paramGenre] = quoteJSON(chi.URLParam(r, paramGenre))
	fields[paramEntryID] = quoteJSON(chi.URLParam(r, paramEntryID))
	return marshalArgs(fields)
}

// corpusAssetArgs — genre + entry id + asset id from the path (for deleting one asset).
func corpusAssetArgs(r *http.Request) (json.RawMessage, error) {
	return marshalArgs(map[string]json.RawMessage{
		paramGenre:   quoteJSON(chi.URLParam(r, paramGenre)),
		paramEntryID: quoteJSON(chi.URLParam(r, paramEntryID)),
		paramAssetID: quoteJSON(chi.URLParam(r, paramAssetID)),
	})
}

// corpusIDArgs — just genre and id from the path (for read / delete).
func corpusIDArgs(r *http.Request) (json.RawMessage, error) {
	return marshalArgs(map[string]json.RawMessage{
		paramGenre:   quoteJSON(chi.URLParam(r, paramGenre)),
		paramEntryID: quoteJSON(chi.URLParam(r, paramEntryID)),
	})
}

func marshalArgs(fields map[string]json.RawMessage) (json.RawMessage, error) {
	out, err := json.Marshal(fields)
	if err != nil {
		return nil, dispatcher.BadInput("invalid request")
	}
	return out, nil
}

func quoteJSON(s string) json.RawMessage {
	out, err := json.Marshal(s)
	if err != nil {
		return json.RawMessage(`""`)
	}
	return out
}
