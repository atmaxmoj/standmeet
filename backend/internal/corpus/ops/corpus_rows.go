// corpus_rows.go —— 各 genre 的行 → 那一份统一形状(声明在 corpus.go)。
//
// 四个 genre:raw / wiki / output / subjectivity。subjectivity 的写口另有一条
// (subjectivity_write),但读、删、挂素材都跟其余三个走同一条路。
//
// 地址(path)是**树派生**的:列表一次算全窗口的路径表,详情单条算。owner 不能自设地址,
// 所以这儿没有"path 字段",只有算出来的那个。

package ops

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
)

// rawStatus —— 侧栏那个"待收拾"角标数的就是它:promote 过就算处理完了。
func rawStatus(r *entity.Raw) string {
	if r.IsPromoted() {
		return "promoted"
	}
	return "unprocessed"
}

func rawItem(r *entity.Raw, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreRaw, ID: r.ID(), Body: r.Body(),
		Preview: usecase.LeadLine(r.Body(), previewMaxLen),
		Source:  r.Source(), Status: rawStatus(r),
		Tags: nonNilStrings(r.Tags()), SourceRawIDs: []string{},
		SourceWikiIDs: []string{},
		CreatedAt:     rfc3339(r.CreatedAt()), UpdatedAt: rfc3339(r.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := r.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

func wikiItem(w *entity.Wiki, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreWiki, ID: w.ID(), Title: w.Title(),
		Preview: usecase.LeadLine(w.Body(), previewMaxLen), Excerpt: w.Excerpt(),
		Tags: nonNilStrings(w.Tags()), SourceRawIDs: nonNilStrings(w.SourceRawIDs()),
		SourceWikiIDs: []string{},
		ShowAsSource:  w.ShowAsSource(), Published: w.Published(),
		CreatedAt: rfc3339(w.CreatedAt()), UpdatedAt: rfc3339(w.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := w.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

func outputItem(o *entity.Output, path string) corpusItemOut {
	item := corpusItemOut{
		Genre: genreOutput, ID: o.ID(), Title: o.Title(),
		Preview: usecase.LeadLine(o.Body(), previewMaxLen), Excerpt: o.Excerpt(),
		Tags: nonNilStrings(o.Tags()), SourceRawIDs: []string{},
		SourceWikiIDs: nonNilStrings(o.SourceWikiIDs()),
		ShowAsSource:  o.ShowAsSource(), Published: o.Published(),
		CreatedAt: rfc3339(o.CreatedAt()), UpdatedAt: rfc3339(o.UpdatedAt()),
		Path: pathOrNil(path),
	}
	if pid, ok := o.ParentID(); ok {
		item.ParentID = &pid
	}
	return item
}

// ── 搜索命中的行（meta）→ 同一份形状 ────────────────────────────────────────
// 全文搜返回的是 **meta**：有 snippet、没有完整 body（一次搜几百条不该把正文都拖出来）。
// 客户端不该因此分两种解析，所以这里映射成跟列表一模一样的行，只是 `preview` 装的是
// 命中片段。**空的字段是「这条路没带回来」，不是「这条笔记没有」** —— tags/来源 id 留空数组，
// 想要就走 corpus.get（[[empty-is-not-json-null]] 的反面：别把没取当成没有）。

// **地址（path）留空是有意的**：搜索命中的是一条一条散落的行，它们的祖先链没跟着回来，
// 而 path 是**从祖先链派生**的。凭手上这点信息拼一个出来就是编。行里的 `id` 已经够打开它
// （`corpus.get` / 面板的编辑表单都按 id）。

// metaPreview —— 命中片段要走**跟列表同一套**的清洗再当预览。
//
// 直接把 `ts_headline` 的原文塞进 preview，owner 在后台看到的是
// `> [!i18n] > <label><input type="radio" name="ashby-lang" checked>EN</label>…`
// —— 真 vault 的笔记正文开头就是那段 i18n callout 的 HTML。**原始标记漏到 owner 眼前**
// 是这一族缺陷的老样子，而且是我加搜索时自己引进来的（⑤ 眼验当场抓到）。
// 片段全是结构 → LeadLine 返回空 → 卡片不显示预览，跟普通列表的行为一致。
func metaPreview(snippet string) string {
	return usecase.SearchSnippet(snippet, previewMaxLen)
}

func wikiMetaItem(m *repo.WikiMeta) corpusItemOut {
	return corpusItemOut{
		Genre: genreWiki, ID: m.ID, Title: m.Title,
		Preview:   metaPreview(m.Snippet),
		ParentID:  m.ParentID,
		Published: m.Published,
		Tags:      []string{}, SourceRawIDs: []string{}, SourceWikiIDs: []string{},
		UpdatedAt: rfc3339OrEmpty(m.UpdatedAt),
	}
}

func outputMetaItem(m *repo.OutputMeta) corpusItemOut {
	return corpusItemOut{
		Genre: genreOutput, ID: m.ID, Title: m.Title,
		Preview:   metaPreview(m.Snippet),
		ParentID:  m.ParentID,
		Published: m.Published,
		Tags:      []string{}, SourceRawIDs: []string{}, SourceWikiIDs: []string{},
		UpdatedAt: rfc3339OrEmpty(m.UpdatedAt),
	}
}

// noteMetaItem —— raw 和 subjectivity 走的是同一份 meta 形状。
//
// 四个 genre 现在都带 UpdatedAt（搜索那条查询把它取上了），取不到时**留空**。
// 这里原来写着「搜索那条查询没取它，**空着比填一个假时间诚实**」—— 道理是对的，
// 只是当初只扫到了 raw/subjectivity 两个 genre，wiki/output 照旧把零值渲成
// `1970-01-01T00:00:00Z` 发出去（F-L-46 / [[lesson-not-swept-to-neighbours]]）。
// 现在四个 genre 共用 `rfc3339OrEmpty`，那条道理由一个函数落实，不靠记性。
func noteMetaItem(m *repo.NoteMeta, genre string) corpusItemOut {
	return corpusItemOut{
		Genre: genre, ID: m.ID, Title: m.Title,
		Preview:   metaPreview(m.Snippet),
		ParentID:  m.ParentID,
		Published: m.Published,
		UpdatedAt: rfc3339OrEmpty(m.UpdatedAt),
		Tags:      []string{}, SourceRawIDs: []string{}, SourceWikiIDs: []string{},
	}
}

// rfc3339OrEmpty —— 0 = 这条路没取到时间，**留空**。零值渲成 `1970-01-01T00:00:00Z`
// 是把「不知道」说成一个具体日期（F-L-46）。搜索那条查询现在取 updated_at 了，
// 所以正常情况下不会走到空的那一支；留着它是因为「没有值」永远好过「假值」。
func rfc3339OrEmpty(unix int64) string {
	if unix <= 0 {
		return ""
	}
	return rfc3339(time.Unix(unix, 0).UTC())
}

func pathOrNil(p string) *string {
	if p == "" {
		return nil
	}
	return &p
}

func listRawItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Raw.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list raw: %w", err)
	}
	paths := usecase.RawTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, rawItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func listWikiItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Wiki.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list wiki: %w", err)
	}
	paths := usecase.WikiTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, wikiItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func listOutputItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Output.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list output: %w", err)
	}
	paths := usecase.OutputTreePaths(rows)
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, outputItem(&rows[i], paths[rows[i].ID()]))
	}
	return out, nil
}

func getRawItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Raw.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get raw: %w", err)
	}
	return rawItem(&row, ""), nil
}

func getWikiItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Wiki.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get wiki: %w", err)
	}
	item := wikiItem(&row, entryPath(ctx, deps, genreWiki, ownerID, id))
	item.Body = row.Body()
	return item, nil
}

func getOutputItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Output.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get output: %w", err)
	}
	item := outputItem(&row, entryPath(ctx, deps, genreOutput, ownerID, id))
	item.Body = row.Body()
	return item, nil
}

// subjectivityItem —— 一条自我模型的那份统一形状。它没有 published / excerpt / 来源边:
// 那是它跟别的 genre 真实的差别,不适用的留零值。
func subjectivityItem(row *repo.Note) corpusItemOut {
	return corpusItemOut{
		Genre: genreSubjectivity, ID: row.ID, Title: row.Title, Body: row.Body,
		Preview: usecase.LeadLine(row.Body, previewMaxLen),
		Tags:    nonNilStrings(row.Tags), ShowAsSource: row.ShowAsSource,
		SourceRawIDs: []string{}, SourceWikiIDs: []string{},
		ParentID: row.ParentID,
	}
}

func listSubjectivityItems(
	ctx context.Context, deps usecase.Deps, ownerID string, limit int32,
) ([]corpusItemOut, error) {
	rows, err := deps.Subjectivity.ListByOwner(ctx, ownerID, limit)
	if err != nil {
		return nil, fmt.Errorf("list subjectivity: %w", err)
	}
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, subjectivityItem(&rows[i]))
	}
	return out, nil
}

// getSubjectivityItem —— 读回一条自我模型。
//
// 它以前读不回来:corpus.get 的 genre 白名单只有 raw/wiki/output,错误信息还写着
// "genre must be 'raw', 'wiki' or 'output'" —— 一句否认这个 genre 存在的话。
// 于是它能写(subjectivity_write)、能删(corpus.delete),就是**读不回来**,
// 也因此挂不了素材(挂完没有任何路能看见)。
func getSubjectivityItem(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) (corpusItemOut, error) {
	row, err := deps.Subjectivity.GetByID(ctx, ownerID, id)
	if err != nil {
		return corpusItemOut{}, fmt.Errorf("get subjectivity: %w", err)
	}
	return subjectivityItem(&row), nil
}

// entryPath —— 单条的树派生地址。算不出就空:地址是展示用的一半,不该让详情打不开。
func entryPath(ctx context.Context, deps usecase.Deps, genre, ownerID, id string) string {
	var (
		path string
		err  error
	)
	switch genre {
	case genreWiki:
		path, err = usecase.WikiEntryPath(ctx, deps.Wiki, ownerID, id)
	case genreOutput:
		path, err = usecase.OutputEntryPath(ctx, deps.Output, ownerID, id)
	default:
		return ""
	}
	if err != nil {
		return ""
	}
	return path
}
