// corpus_views.go —— 树视图 / 分页视图的 item 形状与转换器。
//
// 这两个视图是**面板独有**的浏览形态(懒加载的树节点、按页取),不经出站收口:收口给的是
// "一条语料",它们要的是"这一层有哪些节点、还有没有下一层"。所以 item 里有 has_children,
// 那是位置信息,不是语料的属性。
//
// 语料本身的形状在 internal/corpus/ops —— 列表 / 详情 / 写 全部经收口,两个面同一份。

package admin

import (
	"encoding/json"
	"log/slog"
	"net/http"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// timeRFC3339 —— 这两个视图的时间戳跟收口那份对齐。
const timeRFC3339 = "2006-01-02T15:04:05Z07:00"

// excerptMaxLen —— 卡片上那段干净首段的长度(跟域里的 previewMaxLen 同值)。
const excerptMaxLen = 200

type rawListItem struct {
	ParentID  *string `json:"parent_id"`
	Path      *string `json:"path"`
	CreatedAt string  `json:"created_at"`
	ID        string  `json:"id"`
	Body      string  `json:"body"`
	// Preview —— 干净的首段(LeadLine:剥掉标记和结构),卡片显示它;Body 是给就地编辑用的原文。
	Preview string   `json:"preview"`
	Source  string   `json:"source"`
	Status  string   `json:"status"`
	Tags    []string `json:"tags"`
	// HasChildren —— 树视图专有:这个节点还能往下钻(懒加载那一层)。
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

// rawStatus —— 侧栏那个"待收拾"角标数的就是它:promote 过就算处理完了。
func rawStatus(r *corpus.Raw) string {
	if r.IsPromoted() {
		return "promoted"
	}
	return "unprocessed"
}

// wikiItemFromDomain —— path 由 caller 传(树派生地址,从 parent 链算)。
func wikiItemFromDomain(w *corpus.Wiki, path string) wikiListItem {
	return wikiListItem{
		ID:    w.ID(),
		Title: w.Title(),
		// Excerpt 是**另写**的那份(可能为空);Preview 是正文派生的兜底,卡片在 Excerpt
		// 为空时才显示它 —— 截断出来的东西永远不是摘要本身。
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

// optionalToPtr —— 域的 (string, bool) getter(如 ParentID)→ *string,给 JSON 的
// omitempty 用。传方法引用而不是调用结果,是为了避开 revive 把 ok 当控制布尔的误判。
func optionalToPtr(get func() (string, bool)) *string {
	v, ok := get()
	if !ok {
		return nil
	}
	cp := v
	return &cp
}

// ptrIfNonEmpty —— 空串 → nil(JSON null / 省略),非空 → 指针。
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

// logEncodeErr —— 收口 json encode error 的 slog 调用,每个 helper 自带 msg。
func logEncodeErr(log *slog.Logger, msg string, err error) {
	if err != nil {
		log.Error(msg, "err", err)
	}
}

// treeItem —— 树/分页视图会出的三种 item。写成具名约束而不是 any:这个写出口只服务这三种,
// 钉死了就没人能顺手把别的东西从这儿发出去。
type treeItem interface {
	rawListItem | wikiListItem | outputListItem
}

// writeItemsJSON —— 树/分页视图统一的 200 + 数组。
func writeItemsJSON[T treeItem](log *slog.Logger, w http.ResponseWriter, msg string, items []T) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	logEncodeErr(log, msg, json.NewEncoder(w).Encode(items))
}
