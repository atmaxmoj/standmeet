// corpus.go — admin's corpus facade: list / detail / create / update / delete / promote,
// with genre carried as a path parameter.
//
// All ability is taken through the outbound convergence point (declared in
// internal/corpus/ops); this layer keeps only the REST shape: genre in the path, id in
// the path, everything else in the body, and whether a success returns 200, 201, or 204.
//
// The tree view (/tree) and the tag row (/tags) are panel-only ops (Only "admin"); the grid
// pages through corpus.list like every other owner list (docs/design/paging.md).

package admin

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CorpusDeps — op source for the admin corpus handlers.
type CorpusDeps struct {
	Face *dispatcher.Face
}

const (
	paramGenre   = "genre"
	paramEntryID = "id"
	paramAssetID = "asset_id"
)

// MountCorpus mounts corpus's list + create routes: genre is a path parameter (merging
// the original three URL sets — /raw, /wiki, /output — since genre was always a
// parameter, and shouldn't have been split into different endpoints).
func (h *Handlers) MountCorpus(r chi.Router) {
	face := h.Corpus.Face
	r.Get("/corpus/{genre}", h.dispatchOp(face, "corpus.list",
		pagedWithURLParam(paramGenre, "tag", "q", "state"), jsonOK))
	r.Post("/corpus/{genre}", h.dispatchOp(face, "corpus.create", corpusBodyArgs, jsonCreated))
	// search — finds an entry by content. The list only gives the latest page, while an
	// owner's corpus runs to thousands of entries: "open my good-regulator-theorem entry"
	// used to be impossible on this facade (F-L-39).
	r.Get("/corpus/{genre}/search", h.dispatchOp(face, "corpus.search", corpusSearchArgs, jsonOK))
	// tree — one lazily loaded layer (?parent=; empty = the roots). tags — every tag this genre
	// has ever used; the panel's tag row reads it. Both panel-only ops (corpus/ops/corpus_tree.go).
	r.Get("/corpus/{genre}/tree", h.dispatchOp(face, "corpus.tree",
		pagedWithURLParam(paramGenre, "parent"), jsonOK))
	r.Get("/corpus/{genre}/tags", h.dispatchOp(face, "corpus.tags",
		pagedWithURLParam(paramGenre), jsonOK))
	// check-i18n — read-only (it's a POST because the payload goes in the body, not
	// because it changes anything). The panel's editor calls this once before saving, and
	// gets back the same diagnostics the MCP write entrypoint would reject on.
	r.Post("/corpus/check-i18n", h.dispatchOp(face, "corpus.check_i18n", bodyArgs, jsonOK))
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

// assetPoolIDArgs — just the asset id from the path (global pool delete / references).
func assetPoolIDArgs(r *http.Request) (json.RawMessage, error) {
	return marshalArgs(map[string]json.RawMessage{
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
