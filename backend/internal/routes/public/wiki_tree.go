// wiki_tree.go —— GET /api/v1/wiki-tree[?parent=ID] —— lazy-loaded hierarchy for
// sidebar navigation. Empty parent → roots; parent=ID → ID's direct children. One
// level at a time, fetched only when the frontend expands a node.
//
// scope: a valid bearer (code session) → role corpus_uris; otherwise anonymous →
// published. An invalid/missing token safely falls back to anonymous (a public
// endpoint, never returns 401).

package public

import (
	"encoding/json"
	"log/slog"
	"net/http"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

func (h *SEOHandlers) getWikiTree() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, _ := bearerToken(r)
		scope := owner.WikiTreeScopeFor(r.Context(), h.Sessions, token)
		nodes, err := owner.WikiTreeChildren(
			r.Context(), h.Deps, r.URL.Query().Get("parent"), scope,
		)
		if err != nil {
			h.Log.Error("wiki tree", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWikiTree(h.Log, w, nodes)
	}
}

type wikiTreeStatsView struct {
	Entries int `json:"entries"`
	Roots   int `json:"roots"`
	Gated   int `json:"gated"`
}

// getWikiTreeStats —— GET /api/v1/wiki-tree/stats —— the sidebar footer's count.
// **Same gate as wiki-tree**: a valid bearer → role scope, otherwise anonymous. The
// previous version never looked at the token here, so an invited visitor read a
// GATED count that described someone else's scope (F-L-14).
// logErrKey —— the slog error field name (the "err" literal appears many times in
// this file, pulled into a constant to pass add-constant).
const logErrKey = "err"

func (h *SEOHandlers) getWikiTreeStats() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, _ := bearerToken(r)
		scope := owner.WikiTreeScopeFor(r.Context(), h.Sessions, token)
		stats, err := owner.WikiTreeStats(r.Context(), h.Deps, scope)
		if err != nil {
			h.Log.Error("wiki tree stats", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		view := wikiTreeStatsView{Entries: stats.Entries, Roots: stats.Roots, Gated: stats.Gated}
		if eerr := json.NewEncoder(w).Encode(view); eerr != nil {
			h.Log.Error("encode wiki tree stats", logErrKey, eerr)
		}
	}
}

// getWikiTreeContext —— GET /api/v1/wiki-tree/context?path=... —— an entry's ancestor
// chain (breadcrumb) + direct children (SubEntriesRail). Same scope as wiki-tree.
func (h *SEOHandlers) getWikiTreeContext() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, _ := bearerToken(r)
		scope := owner.WikiTreeScopeFor(r.Context(), h.Sessions, token)
		out, err := owner.WikiNodeContext(
			r.Context(), h.Deps, r.URL.Query().Get("path"), scope,
		)
		if err != nil {
			h.Log.Error("wiki tree context", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWikiTreeContext(h.Log, w, &out)
	}
}

type wikiTreeNodeView struct {
	ID          string `json:"id"`
	Title       string `json:"title"`
	Path        string `json:"path"`
	HasChildren bool   `json:"has_children"`
}

type wikiTreeResponse struct {
	Nodes []wikiTreeNodeView `json:"nodes"`
}

type wikiTreeContextResponse struct {
	Ancestors []wikiTreeNodeView `json:"ancestors"`
	Children  []wikiTreeNodeView `json:"children"`
}

func writeWikiTreeContext(log *slog.Logger, w http.ResponseWriter, ctx *owner.WikiContext) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	resp := wikiTreeContextResponse{
		Ancestors: toNodeViews(ctx.Ancestors),
		Children:  toNodeViews(ctx.Children),
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Error("encode wiki tree context", "err", err)
	}
}

func writeWikiTree(log *slog.Logger, w http.ResponseWriter, nodes []owner.WikiTreeNode) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(wikiTreeResponse{Nodes: toNodeViews(nodes)}); err != nil {
		log.Error("encode wiki tree", "err", err)
	}
}

func toNodeViews(nodes []owner.WikiTreeNode) []wikiTreeNodeView {
	views := make([]wikiTreeNodeView, 0, len(nodes))
	for i := range nodes {
		views = append(views, wikiTreeNodeView{
			ID: nodes[i].ID, Title: nodes[i].Title,
			Path: nodes[i].Path, HasChildren: nodes[i].HasChildren,
		})
	}
	return views
}

// getCorpusCards —— GET /api/v1/corpus-cards —— every PUBLISHED wiki entry as a home-page card
// (title + excerpt + reader path), in tree order. Keyless + anonymous: it only ever returns
// published entries, so a custom page (the redesigned homepage among them) can render corpus
// cards without any risk of leaking an unpublished note — which is what lets the old pinned-cards
// machinery + its unpublish cascade be retired. Lives here, not in a new file, because it's the
// same public keyless corpus-read family as the tree reads above (all already direct-to-facade).
func (h *SEOHandlers) getCorpusCards() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cards, err := owner.ListPublishedCards(r.Context(), h.Deps)
		if err != nil {
			h.Log.Error("corpus cards", logErrKey, err)
			writeError(h.Log, w, serverErr())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if eerr := json.NewEncoder(w).Encode(toCorpusCardsResponse(cards)); eerr != nil {
			h.Log.Error("encode corpus cards", logErrKey, eerr)
		}
	}
}

type corpusCardView struct {
	Title   string `json:"title"`
	Excerpt string `json:"excerpt"`
	Path    string `json:"path"`
}

type corpusCardsResponse struct {
	Cards []corpusCardView `json:"cards"`
}

func toCorpusCardsResponse(cards []owner.CorpusCard) corpusCardsResponse {
	views := make([]corpusCardView, 0, len(cards))
	for i := range cards {
		views = append(views, corpusCardView{
			Title: cards[i].Title, Excerpt: cards[i].Excerpt, Path: cards[i].Path,
		})
	}
	return corpusCardsResponse{Cards: views}
}
