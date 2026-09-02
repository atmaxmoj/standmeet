// prompts.go —— GET /api/v1/prompts/{id} —— single-source prompt fragment reads.
//
// Phase D-1: prompts/ was pulled out into backend/internal/prompts embed.FS; this
// endpoint lets the frontend (visitor chat agent loop) fetch a fragment itself and
// render it into the system prompt, no longer depending on backend assembly. id
// supports sub-paths (e.g. "capabilities/corpus.retrieval"), captured by chi's
// wildcard `*`. Returns text/plain; ErrPromptNotFound → 404.

package public

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// PromptsHandlers —— dependencies for the prompts route. embed .md goes through the
// package-level prompts.FS; Fallback is injected by the composition root (=
// registry.PromptFragmentText), serving capability fragments that have already moved
// out into plugin instructions and no longer have a .md
// (GET /prompts/capabilities/<id>).
type PromptsHandlers struct {
	Log      *slog.Logger
	Fallback func(ctx context.Context, id string) (string, bool)
}

// Mount wires GET /prompts/*. Caller owns the prefix.
func (h *PromptsHandlers) Mount(r chi.Router) {
	r.Get("/prompts/*", h.get())
}

func (h *PromptsHandlers) get() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "*")
		body, ok := h.loadPromptOrWriteErr(r.Context(), w, id)
		if !ok {
			return
		}
		writePromptBody(h.Log, w, id, body)
	}
}

// loadPromptOrWriteErr —— returns immediately on an embed .md hit; on a miss falls
// back to the registry (external capability fragment); neither → 404. Error routing is
// moved out of the handler to keep cyclo ≤ 3.
func (h *PromptsHandlers) loadPromptOrWriteErr(
	ctx context.Context, w http.ResponseWriter, id string,
) (string, bool) {
	body, err := owner.LoadPromptFragment(id)
	if err == nil {
		return body, true
	}
	if !errors.Is(err, owner.ErrPromptFragmentNotFound) {
		h.Log.Error("prompts load", "id", id, "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return "", false
	}
	return h.fallbackOr404(ctx, w, id)
}

// fallbackOr404 —— when the embed .md misses: tries the registry fallback (external
// capability fragment), neither → 404.
func (h *PromptsHandlers) fallbackOr404(
	ctx context.Context, w http.ResponseWriter, id string,
) (string, bool) {
	if h.Fallback != nil {
		if text, ok := h.Fallback(ctx, id); ok {
			return text, true
		}
	}
	http.Error(w, "prompt not found", http.StatusNotFound)
	return "", false
}

func writePromptBody(log *slog.Logger, w http.ResponseWriter, id, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if _, werr := w.Write([]byte(body)); werr != nil {
		log.Error("prompts write", "id", id, "err", werr)
	}
}
