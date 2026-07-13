// corpus_page.go —— GET /corpus/{genre}/page?cursor= —— admin grid 的 keyset 分页
// (infinite scroll)。一次一页(gridPageSize),LIMIT+1 判 has_more,next_cursor 是本页
// 最末行的 (created_at,id) base64 编码。前端累积 + 虚拟列表渲染,永不一次性拉全量。

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

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

const gridPageSize = 30

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
		rows, err := h.Corpus.Corpus.Wiki.ListPage(r.Context(), ownerID, cursor, gridPageSize+1)
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
		rows, err := h.Corpus.Corpus.Output.ListPage(r.Context(), ownerID, cursor, gridPageSize+1)
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
		rows, err := h.Corpus.Corpus.Raw.ListPage(r.Context(), ownerID, cursor, gridPageSize+1)
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
func nextWikiCursor(rows []postgres.TreeChild[domain.Wiki]) string {
	last := &rows[gridPageSize-1].Entry
	return encodeCursor(last.CreatedAt(), last.ID())
}

func nextOutputCursor(rows []postgres.TreeChild[domain.Output]) string {
	last := &rows[gridPageSize-1].Entry
	return encodeCursor(last.CreatedAt(), last.ID())
}

func nextRawCursor(rows []postgres.TreeChild[domain.Raw]) string {
	last := &rows[gridPageSize-1].Entry
	return encodeCursor(last.CreatedAt(), last.ID())
}

func writeWikiPage(
	log *slog.Logger, w http.ResponseWriter, rows []postgres.TreeChild[domain.Wiki],
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
	log *slog.Logger, w http.ResponseWriter, rows []postgres.TreeChild[domain.Output],
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
	log *slog.Logger, w http.ResponseWriter, rows []postgres.TreeChild[domain.Raw],
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

func decodeCursor(s string) (*postgres.PageCursor, error) {
	if s == "" {
		return nil, nil //nolint:nilnil // empty cursor = first page, not an error
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("cursor b64: %w", err)
	}
	return parseCursor(string(raw))
}

func parseCursor(raw string) (*postgres.PageCursor, error) {
	ts, id, ok := strings.Cut(raw, "|")
	if !ok {
		return nil, errors.New("cursor missing separator")
	}
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return nil, fmt.Errorf("cursor time: %w", err)
	}
	return &postgres.PageCursor{CreatedAt: t, ID: id}, nil
}
