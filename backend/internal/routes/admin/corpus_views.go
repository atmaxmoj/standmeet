// corpus_views.go — item shapes and converters for the tree view / page view.
//
// These two views are browsing shapes **unique to the panel** (lazily-loaded tree nodes,
// fetched by page) and don't go through the outbound convergence point: the convergence
// point gives "one corpus entry", these views need "which nodes are at this layer, is
// there another layer below". That's why item carries has_children — that's positional
// information, not an attribute of the corpus entry itself.
//
// The corpus entry's own shape lives in internal/corpus/ops — list / detail / write all go
// through the convergence point, both facades share the same one.

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// timeRFC3339 — keeps these two views' timestamps aligned with the convergence point's.
const timeRFC3339 = "2006-01-02T15:04:05Z07:00"

// excerptMaxLen — length of the clean lead paragraph shown on the card (same value as
// the domain's previewMaxLen).
const excerptMaxLen = 200

type rawListItem struct {
	ParentID  *string `json:"parent_id"`
	Path      *string `json:"path"`
	CreatedAt string  `json:"created_at"`
	ID        string  `json:"id"`
	Body      string  `json:"body"`
	// Preview — the clean lead paragraph (LeadLine: strips markup and structure), shown
	// on the card; Body is the raw text used for in-place editing.
	Preview string   `json:"preview"`
	Source  string   `json:"source"`
	Status  string   `json:"status"`
	Tags    []string `json:"tags"`
	// HasChildren — tree-view only: whether this node can still be drilled into (the
	// lazily-loaded layer).
	HasChildren bool `json:"has_children,omitempty"`
}

type wikiListItem struct {
	ParentID     *string  `json:"parent_id"`
	Path         *string  `json:"path"`
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Excerpt      string   `json:"excerpt"`
	Preview      string   `json:"preview,omitempty"`
	CreatedAt    string   `json:"created_at"`
	Tags         []string `json:"tags"`
	SourceRawIDs []string `json:"source_raw_ids"`
	ShowAsSource bool     `json:"show_as_source"`
	Published    bool     `json:"published"`
	HasChildren  bool     `json:"has_children,omitempty"`
}

type outputListItem struct {
	ParentID      *string  `json:"parent_id"`
	Path          *string  `json:"path"`
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	CreatedAt     string   `json:"created_at"`
	Tags          []string `json:"tags"`
	SourceWikiIDs []string `json:"source_wiki_ids"`
	ShowAsSource  bool     `json:"show_as_source"`
	Published     bool     `json:"published"`
	HasChildren   bool     `json:"has_children,omitempty"`
}

func rawItemFromDomain(r *corpus.Raw) rawListItem {
	return rawListItem{
		ID:        r.ID(),
		Body:      r.Body(),
		Preview:   corpus.LeadLine(r.Body(), excerptMaxLen),
		Source:    r.Source(),
		Tags:      ensureSlice(r.Tags()),
		Status:    rawStatus(r),
		CreatedAt: r.CreatedAt().UTC().Format(timeRFC3339),
	}
}

// rawStatus — what the sidebar's "to process" badge counts: once promoted, it counts as
// handled.
func rawStatus(r *corpus.Raw) string {
	if r.IsPromoted() {
		return "promoted"
	}
	return "unprocessed"
}

// wikiItemFromDomain — path is passed in by the caller (a tree-derived address, computed
// from the parent chain).
func wikiItemFromDomain(w *corpus.Wiki, path string) wikiListItem {
	return wikiListItem{
		ID:    w.ID(),
		Title: w.Title(),
		// Excerpt is the **separately written** one (can be empty); Preview is the
		// body-derived fallback, shown by the card only when Excerpt is empty —
		// something truncated out of the body is never the summary itself.
		Excerpt:      w.Excerpt(),
		Preview:      corpus.LeadLine(w.Body(), excerptMaxLen),
		Tags:         ensureSlice(w.Tags()),
		SourceRawIDs: ensureSlice(w.SourceRawIDs()),
		ParentID:     optionalToPtr(w.ParentID),
		Path:         ptrIfNonEmpty(path),
		ShowAsSource: w.ShowAsSource(),
		Published:    w.Published(),
		CreatedAt:    w.CreatedAt().UTC().Format(timeRFC3339),
	}
}

func outputItemFromDomain(o *corpus.Output, path string) outputListItem {
	return outputListItem{
		ID:            o.ID(),
		Title:         o.Title(),
		Tags:          ensureSlice(o.Tags()),
		SourceWikiIDs: ensureSlice(o.SourceWikiIDs()),
		ParentID:      optionalToPtr(o.ParentID),
		Path:          ptrIfNonEmpty(path),
		ShowAsSource:  o.ShowAsSource(),
		Published:     o.Published(),
		CreatedAt:     o.CreatedAt().UTC().Format(timeRFC3339),
	}
}

// optionalToPtr converts a domain (string, bool) getter (like ParentID) → *string, for
// JSON's omitempty. It takes a method reference rather than the call's result to dodge a
// revive false positive that flags ok as a control boolean.
func optionalToPtr(get func() (string, bool)) *string {
	v, ok := get()
	if !ok {
		return nil
	}
	cp := v
	return &cp
}

// ptrIfNonEmpty — an empty string → nil (JSON null / omitted), non-empty → a pointer.
func ptrIfNonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func ensureSlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// logEncodeErr centralizes the slog call for a json encode error; each helper supplies
// its own msg.
func logEncodeErr(log *slog.Logger, msg string, err error) {
	if err != nil {
		log.Error(msg, "err", err)
	}
}

// treeItem — the three item kinds the tree/page views can emit. Written as a named
// constraint rather than any: this write path only ever serves these three, and pinning
// it down means no one can casually send something else out through it.
type treeItem interface {
	rawListItem | wikiListItem | outputListItem
}

// writeItemsJSON — the tree/page views' shared 200 + array response.
func writeItemsJSON[T treeItem](log *slog.Logger, w http.ResponseWriter, msg string, items []T) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	logEncodeErr(log, msg, json.NewEncoder(w).Encode(items))
}
