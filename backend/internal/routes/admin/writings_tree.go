// writings_tree.go —— writings 的懒树 + grid keyset 分页(跟 raw/wiki/output 同套 scale-safe
// 机制,只是 writings 有自己的 /writings 路由 + 更重的 item:slug/cover/asset URL)。
// GET /writings/tree?parent= 一层懒加载;GET /writings/page?cursor= 一页。writings 是
// corpus_notes 的 genre='writing',所以后端复用 TreeChild/PageCursor 那套。

package admin

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// WritingsTreeProvider —— 懒树一层 + 分页一页(concrete *corpus.WritingRepo 实现)。
type WritingsTreeProvider interface {
	ListChildrenTree(
		ctx context.Context, ownerID string, parentID *string,
	) ([]corpus.TreeChild[corpus.Writing], error)
	ListPage(
		ctx context.Context, ownerID string, cursor *corpus.PageCursor, limit int32,
	) ([]corpus.TreeChild[corpus.Writing], error)
}

type writingsPageResponse struct {
	NextCursor string        `json:"next_cursor,omitempty"`
	Items      []writingView `json:"items"`
}

func (h *Handlers) treeWritings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		rows, err := h.WritingsAdmin.Tree.ListChildrenTree(r.Context(), ownerID, optParent(r))
		if err != nil {
			h.Log.Error("tree writings", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		items := make([]writingView, 0, len(rows))
		for i := range rows {
			v := toWritingViewResolved(r, h, &rows[i].Entry)
			v.HasChildren = rows[i].HasChildren
			items = append(items, v)
		}
		writeWritingsJSON(h, w, "encode writings tree", items)
	}
}

func (h *Handlers) pageWritings() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		cursor, cerr := decodeCursor(r.URL.Query().Get("cursor"))
		if cerr != nil {
			writeError(h.Log, w, envBadReq("bad cursor"))
			return
		}
		rows, err := h.WritingsAdmin.Tree.ListPage(r.Context(), ownerID, cursor, gridPageSize+1)
		if err != nil {
			h.Log.Error("page writings", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWritingsPage(r, h, w, rows)
	}
}

func writeWritingsPage(
	r *http.Request, h *Handlers, w http.ResponseWriter,
	rows []corpus.TreeChild[corpus.Writing],
) {
	page := rows
	next := ""
	if len(rows) > gridPageSize {
		page = rows[:gridPageSize]
		last := &page[len(page)-1].Entry
		next = encodeCursor(last.CreatedAt(), last.ID())
	}
	items := make([]writingView, 0, len(page))
	for i := range page {
		items = append(items, toWritingViewResolved(r, h, &page[i].Entry))
	}
	pageHeader(w)
	resp := writingsPageResponse{Items: items, NextCursor: next}
	logEncodeErr(h.Log, "encode writings page", json.NewEncoder(w).Encode(resp))
}

func writeWritingsJSON(h *Handlers, w http.ResponseWriter, msg string, items []writingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	logEncodeErr(h.Log, msg, json.NewEncoder(w).Encode(items))
}
