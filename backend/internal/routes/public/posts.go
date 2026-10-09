// posts.go —— GET /api/v1/posts[?cursor=&limit=]: the timeline <Posts /> renders. What the caller
// may see: a visitor session's bearer reads as that session's role; no session (or a stale one)
// reads as the public — never a 401, the same rule as the wiki tree.

package public

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// PostsHandlers —— the public timeline.
type PostsHandlers struct {
	Posts    *corpus.PostsService
	Sessions *access.VisitorSessionStore
	Page     owner.PageDeps
	Log      *slog.Logger
}

// Mount wires /posts.
func (h *PostsHandlers) Mount(r chi.Router) {
	r.Get("/posts", h.list())
}

func (h *PostsHandlers) list() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		page, err := h.timeline(r)
		if err != nil {
			h.fail(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store") // what a reader sees depends on its session
		if eerr := json.NewEncoder(w).Encode(page); eerr != nil {
			h.Log.Error("encode posts page", logErrKey, eerr)
		}
	}
}

func (h *PostsHandlers) timeline(r *http.Request) (corpus.PostsPage, error) {
	soleOwner, err := owner.LoadSoleOwner(r.Context(), h.Page)
	if err != nil {
		return corpus.PostsPage{}, err
	}
	q := r.URL.Query()
	args := corpus.PostsArgs{Cursor: q.Get("cursor"), Limit: parseIntOr(q.Get("limit"), 0)}
	token, _ := bearerToken(r)
	return h.Posts.Timeline(r.Context(), soleOwner.ID, h.viewer(r.Context(), token), args)
}

// viewer —— the session's role, or the public (no role) for no / an unknown session.
func (h *PostsHandlers) viewer(ctx context.Context, token string) corpus.PostsViewer {
	data, err := h.Sessions.Get(ctx, token)
	if err != nil || data.RoleSnapshot == nil {
		return corpus.PostsViewer{}
	}
	return corpus.PostsViewer{RoleID: data.RoleSnapshot.RoleID()}
}

func (h *PostsHandlers) fail(w http.ResponseWriter, err error) {
	if errors.Is(err, corpus.ErrPostsCursor) {
		writeError(h.Log, w, envBadReq("bad cursor"))
		return
	}
	h.Log.Error("posts timeline", logErrKey, err)
	writeError(h.Log, w, serverErr())
}
