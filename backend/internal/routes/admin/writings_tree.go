// writings_tree.go —— writings 的懒树 + grid keyset 分页(跟 raw/wiki/output 同套 scale-safe
// 机制,只是 writings 有自己的 /writings 路由 + 更重的 item:slug/cover/asset URL)。
// GET /writings/tree?parent= 一层懒加载;GET /writings/page?cursor= 一页。writings 是
// corpus_notes 的 genre='writing',所以后端复用 TreeChild/PageCursor 那套。
//
// **本域最后一处直连域 facade 的地方。** 保存那条已经搬进收口(见 writings.go),
// 树和分页还没有对应的 op —— 它们是面板独有的视图(懒加载一层 / keyset 一页),
// MCP 那边不需要,所以还没人为它们声明过操作。writingView 这一族 helper 跟着住在这里:
// 它们只服务这两条路由,搬到别处只会把这笔债摊到干净的文件上。

package admin

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

const timeFmt = time.RFC3339

// WritingsAdminDeps —— admin writings handlers 依赖。
//
// Face 给一切经收口的能力(列出 / 保存 / 发布 / 删除)。WritingsTx 只剩一个用处:
// 给树 / 分页那两条视图解素材地址 —— 所以它跟着那笔债住在这个文件里,而不是留在
// writings.go 上让那边看起来还连着域。
type WritingsAdminDeps struct {
	Face       *dispatcher.Face
	WritingsTx corpus.WritingsTxDeps
	Tree       WritingsTreeProvider // lazy tree + grid pagination (concrete WritingRepo)
}

type writingView struct {
	PublishedAt       string `json:"published_at,omitempty"`
	UpdatedAt         string `json:"updated_at"`
	CreatedAt         string `json:"created_at"`
	CoverImageAssetID string `json:"cover_image_asset_id,omitempty"`
	ID                string `json:"id"`
	Slug              string `json:"slug"`
	Title             string `json:"title"`
	Excerpt           string `json:"excerpt"`
	BodyMD            string `json:"body_md"`
	// Preview —— a CLEAN lead excerpt (LeadLine: markup/structure stripped) for the card, shown
	// when Excerpt is empty. BodyMD stays the raw source for editing; the card must never render a
	// raw substring of it (F-R-1 — same class as the raw/wiki lists).
	Preview       string            `json:"preview"`
	CoverHeadline string            `json:"cover_headline"`
	CoverHue      string            `json:"cover_hue"`
	Visibility    string            `json:"visibility"`
	Path          string            `json:"path"`
	LockedBody    string            `json:"locked_body"`
	ParentID      string            `json:"parent_id"`
	AssetURLs     map[string]string `json:"asset_urls"`
	Tags          []string          `json:"tags"`
	CrossRefs     []string          `json:"cross_refs"`
	ReadMinutes   int32             `json:"read_minutes"`
	Published     bool              `json:"published"`
	HasChildren   bool              `json:"has_children,omitempty"`
}

func toWritingViewResolved(r *http.Request, h *Handlers, wg *corpus.Writing) writingView {
	v := toWritingView(wg)
	v.AssetURLs = resolveWritingAssetURLs(r, h, wg)
	return v
}

func resolveWritingAssetURLs(
	r *http.Request, h *Handlers, wg *corpus.Writing,
) map[string]string {
	coverID := wg.CoverImageAssetID()
	var coverPtr *string
	if coverID != "" {
		coverPtr = &coverID
	}
	ids := corpus.WritingAssetIDs(wg.Body(), coverPtr)
	urls, err := corpus.ResolveAssetURLs(
		r.Context(),
		h.WritingsAdmin.WritingsTx.Assets.Repo,
		h.WritingsAdmin.WritingsTx.Assets.Storage,
		ids,
	)
	if err != nil {
		h.Log.Error("resolve asset urls", "err", err)
		return map[string]string{}
	}
	return urls
}

// writingParentIDOr —— parent id 或 ""(root)。editor 回填「设父」用。
func writingParentIDOr(wg *corpus.Writing) string {
	pid, _ := wg.ParentID()
	return pid
}

func toWritingView(wg *corpus.Writing) writingView {
	var pubAtPtr *time.Time
	if pub, ok := wg.PublishedAt(); ok {
		cp := pub
		pubAtPtr = &cp
	}
	return writingView{
		ID: wg.ID(), Slug: wg.Slug(), Title: wg.Title(), Excerpt: wg.Excerpt(),
		BodyMD:        wg.Body(),
		Preview:       corpus.LeadLine(wg.Body(), excerptMaxLen), // clean lead (F-R-1 class)
		CoverHeadline: wg.CoverHeadline(),
		CoverHue:      wg.CoverHue(), CoverImageAssetID: wg.CoverImageAssetID(),
		Tags: wg.Tags(), Visibility: wg.VisibilityMode(), CrossRefs: wg.CrossRefs(),
		Path: wg.Path(), ReadMinutes: wg.ReadMinutes(), LockedBody: wg.LockedBody(),
		ParentID:    writingParentIDOr(wg),
		Published:   wg.IsPublished(),
		PublishedAt: corpus.PublishedAtRFC3339(pubAtPtr),
		CreatedAt:   wg.CreatedAt().Format(timeFmt),
		UpdatedAt:   wg.UpdatedAt().Format(timeFmt),
	}
}

// WritingsTreeProvider —— 懒树一层 + 分页一页(concrete *corpus.WritingRepo 实现)。
type WritingsTreeProvider interface {
	ListChildrenTree(
		ctx context.Context, ownerID string, parentID *string,
	) ([]corpus.TreeChild[corpus.Writing], error)
	ListPage(
		ctx context.Context, ownerID string, cursor *corpus.PageCursor, limit int32, tag string,
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
		rows, err := h.WritingsAdmin.Tree.ListPage(
			r.Context(), ownerID, cursor, gridPageSize+1, pageTag(r))
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
