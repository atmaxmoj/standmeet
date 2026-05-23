// corpus.go —— admin /raw + /wiki list endpoints。
// 当前只做 list（验证 MCP 写入是否真到 DB）；CRUD 写到时再加。

package admin

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/middleware"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// CorpusDeps —— admin corpus handlers 的依赖。
type CorpusDeps struct {
	Corpus usecases.CorpusDeps
}

const (
	defaultCorpusLimit = 50
	maxCorpusLimit     = 200
)

// MountCorpus 挂 /raw + /wiki + /output list + POST /raw（owner 直接 dump）。
func (h *Handlers) MountCorpus(r chi.Router) {
	r.Get("/raw", h.listRaw())
	r.Post("/raw", h.createRaw())
	r.Get("/wiki", h.listWiki())
	r.Get("/output", h.listOutput())
}

type createRawRequest struct {
	Source string   `json:"source"`
	Body   string   `json:"body"`
	Tags   []string `json:"tags"`
}

func (h *Handlers) createRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		var req createRawRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(h.Log, w, envBadReq("invalid JSON body"))
			return
		}
		raw, err := usecases.RawDump(r.Context(), h.Corpus.Corpus, &usecases.RawDumpInput{
			OwnerID: ownerID, Body: req.Body, Source: defaultSource(req.Source), Tags: req.Tags,
		})
		if err != nil {
			handleCreateRawErr(h.Log, w, err)
			return
		}
		writeCreatedRaw(h.Log, w, &raw)
	}
}

func defaultSource(s string) string {
	if s == "" {
		return "admin"
	}
	return s
}

func handleCreateRawErr(log *slog.Logger, w http.ResponseWriter, err error) {
	if errors.Is(err, usecases.ErrEmptyField) {
		writeError(log, w, envBadReq("body is required"))
		return
	}
	log.Error("create raw", "err", err)
	writeError(log, w, serverErr())
}

func writeCreatedRaw(log *slog.Logger, w http.ResponseWriter, raw *domain.RawEntry) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	item := rawListItem{
		ID:        raw.ID,
		Body:      raw.Body,
		Source:    raw.Source,
		Tags:      raw.Tags,
		CreatedAt: raw.CreatedAt.Format(time.RFC3339),
	}
	logEncodeErr(log, "encode created raw", json.NewEncoder(w).Encode(item))
}

type rawListItem struct {
	CreatedAt string   `json:"created_at"`
	ID        string   `json:"id"`
	Body      string   `json:"body"`
	Source    string   `json:"source"`
	Tags      []string `json:"tags"`
}

type wikiListItem struct {
	ParentID     *string  `json:"parent_id"`
	SEOSlug      *string  `json:"seo_slug"`
	ID           string   `json:"id"`
	Title        string   `json:"title"`
	Visibility   string   `json:"visibility"`
	CreatedAt    string   `json:"created_at"`
	Tags         []string `json:"tags"`
	SourceRawIDs []string `json:"source_raw_ids"`
	SEOIndexed   bool     `json:"seo_indexed"`
}

func (h *Handlers) listRaw() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		limit := parseLimit(r.URL.Query().Get("limit"))
		rows, err := h.Corpus.Corpus.Raw.ListByOwner(r.Context(), ownerID, limit)
		if err != nil {
			h.Log.Error("list raw", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeRawList(h.Log, w, rows)
	}
}

func writeRawList(log *slog.Logger, w http.ResponseWriter, rows []domain.RawEntry) {
	items := make([]rawListItem, 0, len(rows))
	for i := range rows {
		items = append(items, rawListItem{
			ID:        rows[i].ID,
			Body:      rows[i].Body,
			Source:    rows[i].Source,
			Tags:      rows[i].Tags,
			CreatedAt: rows[i].CreatedAt.Format(time.RFC3339),
		})
	}
	writeRawListJSON(log, w, items)
}

func (h *Handlers) listWiki() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		limit := parseLimit(r.URL.Query().Get("limit"))
		rows, err := h.Corpus.Corpus.Wiki.ListByOwner(r.Context(), ownerID, limit)
		if err != nil {
			h.Log.Error("list wiki", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeWikiList(h.Log, w, rows)
	}
}

func writeWikiList(log *slog.Logger, w http.ResponseWriter, rows []domain.WikiEntry) {
	items := make([]wikiListItem, 0, len(rows))
	for i := range rows {
		items = append(items, wikiItemFromDomain(&rows[i]))
	}
	writeWikiListJSON(log, w, items)
}

func writeRawListJSON(log *slog.Logger, w http.ResponseWriter, items []rawListItem) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	logEncodeErr(log, "encode raw list", json.NewEncoder(w).Encode(items))
}

func writeWikiListJSON(log *slog.Logger, w http.ResponseWriter, items []wikiListItem) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	logEncodeErr(log, "encode wiki list", json.NewEncoder(w).Encode(items))
}

// logEncodeErr 收口 json encode error 的 slog 调用，避免 add-constant 把
// "err" 字面量统计到上限。每个 helper 自带 msg，调用点 cyclo 不变。
func logEncodeErr(log *slog.Logger, msg string, err error) {
	if err != nil {
		log.Error(msg, "err", err)
	}
}

func parseLimit(s string) int32 {
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return defaultCorpusLimit
	}
	return clampLimit(n)
}

func clampLimit(n int) int32 {
	if n > maxCorpusLimit {
		return maxCorpusLimit
	}
	return int32(n)
}
