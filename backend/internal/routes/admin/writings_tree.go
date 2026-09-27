// writings_tree.go — writings's lazy tree (the same scale-safe mechanism as raw/wiki/output,
// except writings has its own /writings route + a heavier item: slug/cover/asset URL).
// GET /writings/tree?parent= is one lazily-loaded layer. The grid pages through writings.list
// (GET /writings/) like every other owner list (docs/design/paging.md).
//
// **The last place in this domain that connects straight to the domain's facade.** The
// save route has already moved into the convergence point (see writings.go); the tree route
// has no corresponding op yet — it's a view unique to the panel (one lazily-loaded layer),
// MCP doesn't need it, so nobody has declared an operation for it yet. The writingView
// family of helpers lives here alongside it for the same reason: they only serve this route,
// and moving them elsewhere would just spread this debt onto an otherwise clean file.

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

// WritingsAdminDeps — dependencies for the admin writings handlers.
//
// Face provides every op that goes through the convergence point (list / save /
// publish / delete). WritingsTx has exactly one remaining use: resolving asset addresses
// for the tree / page view routes — so it lives alongside that debt in this file, rather
// than staying in writings.go and making that file look like it still touches the domain.
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
		ids,
	)
	if err != nil {
		h.Log.Error("resolve asset urls", "err", err)
		return map[string]string{}
	}
	return urls
}

// writingParentIDOr — the parent id, or "" (root). Used by the editor to pre-fill "set
// parent".
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

// WritingsTreeProvider — one lazy-tree layer (implemented concretely by *corpus.WritingRepo).
// The grid pages through writings.list (GET /writings/, docs/design/paging.md).
type WritingsTreeProvider interface {
	ListChildrenTree(
		ctx context.Context, ownerID string, parentID *string,
	) ([]corpus.TreeChild[corpus.Writing], error)
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

func writeWritingsJSON(h *Handlers, w http.ResponseWriter, msg string, items []writingView) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	logEncodeErr(h.Log, msg, json.NewEncoder(w).Encode(items))
}
