// corpus_page.go — GET /corpus/{genre}/page?cursor= — keyset pagination for the admin
// grid (infinite scroll). One page at a time (gridPageSize), LIMIT+1 decides has_more,
// next_cursor is the base64 encoding of this page's last row's (created_at, id). The
// frontend accumulates + renders a virtual list, never pulling the full set at once.

package admin

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

const gridPageSize = 30

// pageTag — the value of `?tag=`; "" means no filter. Filtering is pushed down to the
// page fetch itself, rather than letting the panel fetch a page and then filter it: the
// latter would only filter that one page, while the panel would treat the result as the
// answer for the whole corpus (F-L-23).
func pageTag(r *http.Request) string {
	return strings.TrimSpace(r.URL.Query().Get("tag"))
}

type genreTagsResponse struct {
	Tags []string `json:"tags"`
}

// tagsWiki — GET /corpus/wiki/tags — every tag this genre has ever used. The panel's tag
// row reads this directly rather than deriving it from the loaded page: the latter would
// give no chip at all to a tag that only exists outside that page (the second half of
// F-L-23).
func (h *Handlers) tagsWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		tags, err := h.Corpus.Corpus.Wiki.ListTags(r.Context(), ownerID)
		if err != nil {
			h.Log.Error("tags wiki", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeJSON(h.Log, w, genreTagsResponse{Tags: tags})
	}
}

type wikiPageResponse struct {
	NextCursor string         `json:"next_cursor,omitempty"`
	Items      []wikiListItem `json:"items"`
}

type outputPageResponse struct {
	NextCursor string           `json:"next_cursor,omitempty"`
	Items      []outputListItem `json:"items"`
}

type rawPageResponse struct {
	NextCursor string        `json:"next_cursor,omitempty"`
	Items      []rawListItem `json:"items"`
}

func (h *Handlers) pageWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		cursor, cerr := decodeCursor(r.URL.Query().Get("cursor"))
		if cerr != nil {
			writeError(h.Log, w, envBadReq("bad cursor"))
			return
		}
		rows, err := h.Corpus.Corpus.Wiki.ListPage(
			r.Context(), ownerID, cursor, gridPageSize+1, pageTag(r))
		if err != nil {
			h.Log.Error("page wiki", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWikiPage(h.Log, w, rows)
	}
}

func (h *Handlers) pageOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		cursor, cerr := decodeCursor(r.URL.Query().Get("cursor"))
		if cerr != nil {
			writeError(h.Log, w, envBadReq("bad cursor"))
			return
		}
		rows, err := h.Corpus.Corpus.Output.ListPage(
			r.Context(), ownerID, cursor, gridPageSize+1, pageTag(r))
		if err != nil {
			h.Log.Error("page output", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeOutputPage(h.Log, w, rows)
	}
}

func (h *Handlers) pageRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		cursor, cerr := decodeCursor(r.URL.Query().Get("cursor"))
		if cerr != nil {
			writeError(h.Log, w, envBadReq("bad cursor"))
			return
		}
		rows, err := h.Corpus.Corpus.Raw.ListPage(
			r.Context(), ownerID, cursor, gridPageSize+1, pageTag(r))
		if err != nil {
			h.Log.Error("page raw", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeRawPage(h.Log, w, rows)
	}
}

// nextWikiCursor —— empty unless the LIMIT+1 fetch overflowed the page; then the last
// in-page row's keyset. Per-genre (domain accessors have pointer receivers).
func nextWikiCursor(rows []corpus.TreeChild[corpus.Wiki]) string {
	last := &rows[gridPageSize-1].Entry
	return encodeCursor(last.CreatedAt(), last.ID())
}

func nextOutputCursor(rows []corpus.TreeChild[corpus.Output]) string {
	last := &rows[gridPageSize-1].Entry
	return encodeCursor(last.CreatedAt(), last.ID())
}

func nextRawCursor(rows []corpus.TreeChild[corpus.Raw]) string {
	last := &rows[gridPageSize-1].Entry
	return encodeCursor(last.CreatedAt(), last.ID())
}

func writeWikiPage(
	log *slog.Logger, w http.ResponseWriter, rows []corpus.TreeChild[corpus.Wiki],
) {
	over := len(rows) > gridPageSize
	page := rows
	next := ""
	if over {
		page = rows[:gridPageSize]
		next = nextWikiCursor(rows)
	}
	items := make([]wikiListItem, 0, len(page))
	for i := range page {
		items = append(items, wikiItemFromDomain(&page[i].Entry, slugJoin(page[i].PathTitles)))
	}
	pageHeader(w)
	resp := wikiPageResponse{Items: items, NextCursor: next}
	logEncodeErr(log, "encode wiki page", json.NewEncoder(w).Encode(resp))
}

func writeOutputPage(
	log *slog.Logger, w http.ResponseWriter, rows []corpus.TreeChild[corpus.Output],
) {
	over := len(rows) > gridPageSize
	page := rows
	next := ""
	if over {
		page = rows[:gridPageSize]
		next = nextOutputCursor(rows)
	}
	items := make([]outputListItem, 0, len(page))
	for i := range page {
		items = append(items, outputItemFromDomain(&page[i].Entry, slugJoin(page[i].PathTitles)))
	}
	pageHeader(w)
	resp := outputPageResponse{Items: items, NextCursor: next}
	logEncodeErr(log, "encode output page", json.NewEncoder(w).Encode(resp))
}

func writeRawPage(
	log *slog.Logger, w http.ResponseWriter, rows []corpus.TreeChild[corpus.Raw],
) {
	over := len(rows) > gridPageSize
	page := rows
	next := ""
	if over {
		page = rows[:gridPageSize]
		next = nextRawCursor(rows)
	}
	items := make([]rawListItem, 0, len(page))
	for i := range page {
		items = append(items, rawTreeItem(&page[i]))
	}
	pageHeader(w)
	resp := rawPageResponse{Items: items, NextCursor: next}
	logEncodeErr(log, "encode raw page", json.NewEncoder(w).Encode(resp))
}

func pageHeader(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
}

func encodeCursor(t time.Time, id string) string {
	return base64.RawURLEncoding.EncodeToString(
		[]byte(t.UTC().Format(time.RFC3339Nano) + "|" + id),
	)
}

func decodeCursor(s string) (*corpus.PageCursor, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // empty cursor = first page, not an error
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("cursor b64: %w", err)
	}
	return parseCursor(string(raw))
}

func parseCursor(raw string) (*corpus.PageCursor, error) {
	ts, id, ok := strings.Cut(raw, "|")
	if !ok {
		return nil, errors.New("cursor missing separator")
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return nil, fmt.Errorf("cursor time: %w", err)
	}
	return &corpus.PageCursor{CreatedAt: t, ID: id}, nil
}
