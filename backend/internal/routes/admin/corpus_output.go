// corpus_output.go —— admin /output list endpoint。从 corpus.go 拆出，
// 守 350 行 max-lines。当前只做 list（验证 MCP 写入是否真到 DB）；下一轮
// 加 CRUD UI 时这里扩。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/middleware"
)

type outputListItem struct {
	ParentID      *string  `json:"parent_id"`
	Path          *string  `json:"path"`
	ID            string   `json:"id"`
	Title         string   `json:"title"`
	CreatedAt     string   `json:"created_at"`
	Tags          []string `json:"tags"`
	SourceWikiIDs []string `json:"source_wiki_ids"`
	ShowAsSource  bool     `json:"show_as_source"`
	SEOIndexed    bool     `json:"seo_indexed"`
}

func (h *Handlers) listOutput() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ownerID := middleware.OwnerIDFrom(r.Context())
		limit := parseLimit(r.URL.Query().Get("limit"))
		rows, err := h.Corpus.Corpus.Output.ListByOwner(r.Context(), ownerID, limit)
		if err != nil {
			h.Log.Error("list output", "err", err)
			writeError(h.Log, w, serverErr())
			return
		}
		writeOutputList(h.Log, w, rows)
	}
}

func writeOutputList(log *slog.Logger, w http.ResponseWriter, rows []domain.Output) {
	items := make([]outputListItem, 0, len(rows))
	for i := range rows {
		items = append(items, outputItemFromDomain(&rows[i]))
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	logEncodeErr(log, "encode output list", json.NewEncoder(w).Encode(items))
}
