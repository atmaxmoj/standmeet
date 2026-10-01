// microsite_store.go — visitor read/write of a microsite's own document store (a poll, a sign-up
// sheet, a guestbook). Scoped hard to the page in the URL: the owner is the sole owner, the page is
// resolved from (owner, slug), and the caller NEVER supplies a page or schema id — so a visitor can
// only reach the page they are on, and one page's writes can never land in another's namespace.
//
// This face never touches the domain directly (check-routes-via-dispatcher): the composition root
// hands it closures that close over the page-store usecase and translate its errors into display
// errors. The per-IP rate guard on the public group already covers the write; the body is capped
// before it is even read; the write's owner-opt-in / quota / doc-size guards live in the usecase.

package public

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// micrositeStoreMaxBody — hard cap on the request body before decoding (usecase caps doc at 8KB;
// this stops a huge body from being buffered at all).
const micrositeStoreMaxBody = 16 * 1024

// MicrositeStoreHandlers — deps for the visitor page-store route. The two closures are wired at the
// composition root (closing over the domain + sole-owner lookup) and already return display errors.
type MicrositeStoreHandlers struct {
	// Opens —— the page's own access rule, the one /p/<slug> applies: a page closed to visitors
	// without a code keeps its store closed to them too (a display error when it refuses).
	Opens  func(r *http.Request, visitor, slug string) error
	Insert func(ctx context.Context, slug, collection string, doc json.RawMessage) (string, error)
	Query  func(
		ctx context.Context, slug, collection string, filter json.RawMessage,
	) ([]json.RawMessage, error)
	Log *slog.Logger
}

// Mount wires GET/POST /pages/{slug}/store onto /api/v1.
func (h *MicrositeStoreHandlers) Mount(r chi.Router) {
	gated := r.With(h.opensGate)
	gated.Get("/pages/{slug}/store", h.query())
	gated.Post("/pages/{slug}/store", h.insert())
}

// opensGate —— the page's own access rule in front of its store (Opens): refused → no such page.
func (h *MicrositeStoreHandlers) opensGate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := h.opens(r); err != nil {
			h.writeStoreErr(w, "page store access", err)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type insertMicrositeDocRequest struct {
	Collection string          `json:"collection"`
	Doc        json.RawMessage `json:"doc"`
}

func (h *MicrositeStoreHandlers) insert() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req insertMicrositeDocRequest
		body := http.MaxBytesReader(w, r.Body, micrositeStoreMaxBody)
		if err := json.NewDecoder(body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid body"))
			return
		}
		id, err := h.Insert(r.Context(), chi.URLParam(r, "slug"), req.Collection, req.Doc)
		if err != nil {
			h.writeStoreErr(w, "page store insert", err)
			return
		}
		writeJSON(h.Log, w, insertedDocResponse{ID: id})
	}
}

func (h *MicrositeStoreHandlers) query() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		docs, err := h.Query(
			r.Context(), chi.URLParam(r, "slug"), r.URL.Query().Get("collection"), nil,
		)
		if err != nil {
			h.writeStoreErr(w, "page store query", err)
			return
		}
		writeJSON(h.Log, w, micrositeStoreDocsResponse{Docs: nonNilDocs(docs)})
	}
}

// writeStoreErr — the closures already return display errors, so Classify with no cases renders
// directly; a 5xx is logged, a mapped 4xx is not. Kept out of the handlers for cyclo ≤ 3.
func (h *MicrositeStoreHandlers) writeStoreErr(w http.ResponseWriter, what string, err error) {
	env := apierr.Classify(err, nil)
	if env.Status >= http.StatusInternalServerError {
		h.Log.Error(what, "err", err)
	}
	writeError(h.Log, w, env)
}

// opens —— the page's access rule for this request; no rule wired = closed (fail closed).
func (h *MicrositeStoreHandlers) opens(r *http.Request) error {
	if h.Opens == nil {
		return apierr.DisplayWrap(http.StatusNotFound, "not_found", "no such page", nil)
	}
	visitor, _ := visitorToken(r)
	return h.Opens(r, visitor, chi.URLParam(r, "slug"))
}

// micrositeStoreBody — a marker so the encoder takes a named type, not `any` (banned in domain).
type micrositeStoreBody interface{ micrositeStoreBody() }

type insertedDocResponse struct {
	ID string `json:"id"`
}

type micrositeStoreDocsResponse struct {
	Docs []json.RawMessage `json:"docs"`
}

func (insertedDocResponse) micrositeStoreBody()        {}
func (micrositeStoreDocsResponse) micrositeStoreBody() {}

func nonNilDocs(docs []json.RawMessage) []json.RawMessage {
	if docs == nil {
		return []json.RawMessage{}
	}
	return docs
}

func writeJSON(log *slog.Logger, w http.ResponseWriter, body micrositeStoreBody) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Warn("encode page store response", "err", err)
	}
}
