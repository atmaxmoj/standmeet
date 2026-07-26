// cap_helpers.go —— Phase E 各 cap_*.go 共用的小工具：通用 list-limit 参数解析、raw/wiki view
// 转换。从 cap_corpus_raw.go 拆出来守 max-lines。(通用 MCPResult JSON 封装已提升为 capreg.MarshalResult。)

package ownercore

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/corpus"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// logErrKey —— slog 错误字段键(避免各 cap 文件重复 "err" 字面量)。
const logErrKey = "err"

// entryRef —— 定位一条刚写入的 corpus entry(算写响应 path 用)。
type entryRef struct {
	genre   string // "wiki" | "output"
	ownerID string
	id      string
}

// entryPathForResponse —— 一条刚写入的 corpus entry 的树派生 path,给写工具的响应用:
// 调用方拿到地址就能 corpus_read / 引用它,不用从 title 反推 slug。best-effort —— path
// 算不出(理论上刚建就在)→ warn + 空串,不搅黄整个写。
func entryPathForResponse(
	ctx context.Context, log *slog.Logger, corpusDeps *usecases.CorpusDeps, ref entryRef,
) string {
	var (
		path string
		err  error
	)
	switch ref.genre {
	case "wiki":
		path, err = usecases.WikiEntryPath(ctx, corpusDeps.Wiki, ref.ownerID, ref.id)
	case "output":
		path, err = usecases.OutputEntryPath(ctx, corpusDeps.Output, ref.ownerID, ref.id)
	default:
		return ""
	}
	if err != nil {
		log.Warn(ref.genre+"_path", "id", ref.id, logErrKey, err)
	}
	return path
}

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

func rawRowsToView(rows []corpus.Raw) []rawCapView {
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

func wikiRowsToView(rows []corpus.Wiki) []wikiCapView {
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
