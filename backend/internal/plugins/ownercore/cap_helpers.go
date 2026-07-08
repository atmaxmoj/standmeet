// cap_helpers.go —— Phase E 各 cap_*.go 共用的小工具：通用 list-limit 参数解析、raw/wiki view
// 转换。从 cap_corpus_raw.go 拆出来守 max-lines。(通用 MCPResult JSON 封装已提升为 capreg.MarshalResult。)

package ownercore

import (
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

type listLimitArgsWire struct {
	Limit *float64 `json:"limit"`
}

// parseListLimit —— 通用 limit 参数解析：缺省 / 非法 → defaultListLimit。
func parseListLimit(raw json.RawMessage) int32 {
	var args listLimitArgsWire
	if len(raw) == 0 || json.Unmarshal(raw, &args) != nil || args.Limit == nil {
		return defaultListLimit
	}
	v := int32(*args.Limit)
	if v <= 0 {
		return defaultListLimit
	}
	return v
}

// ───── raw / wiki view 转换 (E-1 列表 tool 用) ─────────────────

type rawCapView struct {
	CreatedAt string   `json:"created_at"`
	ID        string   `json:"id"`
	Body      string   `json:"body"`
	Source    string   `json:"source"`
	Tags      []string `json:"tags"`
	Archived  bool     `json:"archived"`
}

func rawRowsToView(rows []domain.Raw) []rawCapView {
	out := make([]rawCapView, 0, len(rows))
	for i := range rows {
		out = append(out, rawCapView{
			ID: rows[i].ID(), Body: rows[i].Body(), Source: rows[i].Source(),
			Tags: rows[i].Tags(), Archived: rows[i].Archived(),
			CreatedAt: rows[i].CreatedAt().Format(mcpTimeFmt),
		})
	}
	return out
}

// 地址(path)不在 list_recent 里回显:这里只取最近 N 条(有 limit),不是全树,
// 算不出准确的树派生地址。owner 看结构靠 parent_id;要寻址用 corpus_list/read
// (retriever 那套 load 全树算地址)或 admin 网页浏览。
type wikiCapView struct {
	CreatedAt string   `json:"created_at"`
	ParentID  *string  `json:"parent_id"`
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
}

func wikiRowsToView(rows []domain.Wiki) []wikiCapView {
	out := make([]wikiCapView, 0, len(rows))
	for i := range rows {
		out = append(out, wikiCapView{
			ID: rows[i].ID(), Title: rows[i].Title(), Tags: rows[i].Tags(),
			ParentID:  ptrOrNil(rows[i].ParentID),
			CreatedAt: rows[i].CreatedAt().Format(mcpTimeFmt),
		})
	}
	return out
}
