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

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// CorpusDeps —— admin corpus handlers 的依赖。
type CorpusDeps struct {
	Corpus usecases.CorpusDeps
}

const (
	defaultCorpusLimit = 50
	maxCorpusLimit     = 200
)

// MountCorpus 挂统一的 corpus list + create 路由：genre 作路径参数（合并了原
// /raw · /wiki · /output 三套 URL —— genre 本来就是参数，不该拆成不同 endpoint）。
func (h *Handlers) MountCorpus(r chi.Router) {
	r.Get("/corpus/{genre}", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.listRaw(), "wiki": h.listWiki(), "output": h.listOutput(),
	}))
	r.Get("/corpus/{genre}/tree", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.treeRaw(), "wiki": h.treeWiki(), "output": h.treeOutput(),
		"subjectivity": h.treeSubjectivity(),
	}))
	r.Get("/corpus/{genre}/page", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.pageRaw(), "wiki": h.pageWiki(), "output": h.pageOutput(),
	}))
	r.Post("/corpus/{genre}", h.byGenre(map[string]http.HandlerFunc{
		"raw": h.createRaw(), "wiki": h.createWiki(), "output": h.createOutput(),
	}))
}

// byGenre —— corpus 路由的 genre-参数分派：URL 的 {genre} 选对应 per-genre handler。
// 未知 / 该 op 不支持的 genre → 404 unknown_genre（复刻旧行为：旧无该 genre 路由即 chi 404）。
func (h *Handlers) byGenre(m map[string]http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if handler, ok := m[chi.URLParam(r, "genre")]; ok {
			handler(w, r)
			return
		}
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "unknown_genre", Message: "unknown corpus genre",
		})
	}
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

func writeCreatedRaw(log *slog.Logger, w http.ResponseWriter, raw *domain.Raw) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	item := rawItemBase(raw)
	logEncodeErr(log, "encode created raw", json.NewEncoder(w).Encode(item))
}

// rawItemBase —— the shared raw list-item fields EVERY construction site needs, so none can drift
// on Preview/Status/etc. (F-R-1 shipped broken because the tree path built its own item and missed
// Preview). Path / ParentID / HasChildren are position-specific — the caller sets those.
func rawItemBase(row *domain.Raw) rawListItem {
	return rawListItem{
		ID:        row.ID(),
		Body:      row.Body(),
		Preview:   usecases.LeadLine(row.Body(), excerptMaxLen), // clean lead (F-R-1)
		Source:    row.Source(),
		Tags:      row.Tags(),
		Status:    rawStatus(row),
		CreatedAt: row.CreatedAt().Format(time.RFC3339),
	}
}

type rawListItem struct {
	ParentID  *string `json:"parent_id"`
	Path      *string `json:"path"`
	CreatedAt string  `json:"created_at"`
	ID        string  `json:"id"`
	Body      string  `json:"body"`
	// Preview —— a CLEAN lead excerpt (LeadLine: markup/structure stripped) for the card. Body
	// stays the raw source for inline editing; the card must show Preview, not a raw substring
	// of Body (F-R-1).
	Preview string   `json:"preview"`
	Source  string   `json:"source"`
	Status  string   `json:"status"`
	Tags    []string `json:"tags"`
	// HasChildren —— tree view only: this node can be drilled into (lazy layer).
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

func writeRawList(log *slog.Logger, w http.ResponseWriter, rows []domain.Raw) {
	paths := usecases.RawTreePaths(rows) // raw is now a corpus_notes tree — derive its address
	items := make([]rawListItem, 0, len(rows))
	for i := range rows {
		items = append(items, rawItemOf(&rows[i], paths))
	}
	writeRawListJSON(log, w, items)
}

// rawItemOf —— one raw row → list item, with its derived tree path + parent.
func rawItemOf(row *domain.Raw, paths map[string]string) rawListItem {
	item := rawItemBase(row)
	if p, ok := paths[row.ID()]; ok {
		item.Path = &p
	}
	if pid, ok := row.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

// rawStatus —— the sidebar "raw" badge counts entries that still need
// curation. A raw dump is "unprocessed" until the owner promotes it to wiki
// (MarkPromoted sets promoted_to); after that it's "promoted". Archived rows
// never reach this list. The admin badge filters on status == "unprocessed".
func rawStatus(row *domain.Raw) string {
	if row.IsPromoted() {
		return "promoted"
	}
	return "unprocessed"
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

func writeWikiList(log *slog.Logger, w http.ResponseWriter, rows []domain.Wiki) {
	paths := usecases.WikiTreePaths(rows)
	items := make([]wikiListItem, 0, len(rows))
	for i := range rows {
		items = append(items, wikiItemFromDomain(&rows[i], paths[rows[i].ID()]))
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
