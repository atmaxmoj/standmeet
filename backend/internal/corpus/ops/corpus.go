// corpus.go —— 资源 corpus:owner 的语料本身。raw(想到就倒)/ wiki(收拾过的)/
// output(对外成品)三个 genre 是**同一件事的参数**,不是三套东西 —— 面板早就是
// `/corpus/{genre}` 一条路由,MCP 那边还是 list_recent_raw / list_recent_wiki /
// list_recent_output 三个工具。这里收成一个。
//
// 一个条目在三个 genre 下是**同一份形状**(corpusItemOut):不适用的字段留零值。
// 三份形状才是这次要消掉的东西 —— 归一化前 admin 的 wikiListItem / outputListItem /
// rawListItem 跟 MCP 的 wikiCapView / rawCapView 是五份,彼此都差一点。
//
// body 只在 raw 的列表里带:raw 卡片可以就地编辑,所以列表就得有正文;wiki / output 的
// 列表只给 preview(干净的首段),正文要 corpus.get。这是产品差别,不是两个面在打架。

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// genre 常量 + 每条口收哪几个,都在 genres.go —— 那件事被三处各自答过一遍,现在只有一处。

const (
	// defaultCorpusLimit / maxCorpusLimit —— 列表窗口。面板和 MCP 用同一套上下限。
	defaultCorpusLimit = 50
	maxCorpusLimit     = 200
	// previewMaxLen —— 卡片上那段干净首段的长度。
	previewMaxLen = 200
)

// CorpusReads —— list / get。写那半边在 corpus_write.go。
func CorpusReads(deps usecase.Deps) []fp.Op {
	return []fp.Op{
		{
			ID: "corpus.list",
			Description: "List corpus entries of one genre, newest first. genre is 'raw', " +
				"'wiki' or 'output'. Raw items carry their body (the card edits it in place); " +
				"wiki and output carry a clean lead preview — fetch the body with corpus.get.",
			InputSchema: corpusListSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCorpus(deps),
		},
		{
			ID: "corpus.get",
			Description: "Read one corpus entry in full by genre + id: body, tags, its place " +
				"in the tree, the notes it links to / is linked from, and its files. " +
				"Works for every genre including 'subjectivity'.",
			InputSchema: corpusGetSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getCorpus(deps),
		},
	}
}

var (
	corpusListSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string","description":"'raw' | 'wiki' | 'output'."},
			"limit":{"type":"integer","description":"Max rows (default 50, max 200)."}
		},
		"required":["genre"]
	}`)

	corpusGetSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"genre":{"type":"string",
				"description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
			"id":{"type":"string","description":"Entry id."}
		},
		"required":["genre","id"]
	}`)
)

// corpusItemOut —— 一条语料在每个面上的那一份形状。
//
// 三个 genre 共用它:raw 没有 title / excerpt,wiki 没有 source_wiki_ids,output 没有
// status —— 不适用的就是零值。字段名全是已经发出去的那些(面板的 zod schema 按它们读)。
type corpusItemOut struct {
	ParentID *string `json:"parent_id"`
	Path     *string `json:"path"`
	// hero 区 —— 图 + 压在图上那句话 + 色调。三样都在共享表上,**任意 genre 都能有**。
	CoverImageAssetID *string           `json:"cover_image_asset_id,omitempty"`
	AssetURLs         map[string]string `json:"asset_urls,omitempty"`
	Genre             string            `json:"genre"`
	ID                string            `json:"id"`
	Title             string            `json:"title"`
	Body              string            `json:"body,omitempty"`
	Preview           string            `json:"preview"`
	Excerpt           string            `json:"excerpt"`
	Source            string            `json:"source,omitempty"`
	Status            string            `json:"status,omitempty"`
	CreatedAt         string            `json:"created_at"`
	UpdatedAt         string            `json:"updated_at"`
	CoverHeadline     string            `json:"cover_headline,omitempty"`
	CoverHue          string            `json:"cover_hue,omitempty"`
	Tags              []string          `json:"tags"`
	SourceRawIDs      []string          `json:"source_raw_ids"`
	SourceWikiIDs     []string          `json:"source_wiki_ids"`
	Outbound          []refOut          `json:"outbound,omitempty"`
	Backlinks         []refOut          `json:"backlinks,omitempty"`
	// 素材 —— 挂在这条语料上的图 / 附件。依附文章,可见性继承文章。
	Assets       []usecase.AssetView `json:"assets,omitempty"`
	ShowAsSource bool                `json:"show_as_source"`
	Published    bool                `json:"published"`
	HasChildren  bool                `json:"has_children,omitempty"`
}

// refOut —— 一条 note 之间的边(读下一条 / 被谁引)。
type refOut struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

type corpusListArgs struct {
	Genre string `json:"genre"`
	Limit int32  `json:"limit"`
}

func decodeCorpusList(raw json.RawMessage) (corpusListArgs, error) {
	var in corpusListArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	// 读的口认四个 —— 列表跟 get 是同一件事的两个粒度,一个认 subjectivity、
	// 另一个不认的话,面板能读到单条却列不出来。
	if err := requireGenre(in.Genre); err != nil {
		return in, err
	}
	in.Limit = clampCorpusLimit(in.Limit)
	return in, nil
}

// clampCorpusLimit —— 没说 / 说了个不合法的数 = 默认窗口;上限钉死。
func clampCorpusLimit(n int32) int32 {
	if n <= 0 {
		return defaultCorpusLimit
	}
	if n > maxCorpusLimit {
		return maxCorpusLimit
	}
	return n
}

func listCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusList(raw)
		if perr != nil {
			return nil, perr
		}
		items, err := listByGenre(ctx, deps, ownerID, in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(items)
	}
}

func listByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusListArgs,
) ([]corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		return listRawItems(ctx, deps, ownerID, in.Limit)
	case genreWiki:
		return listWikiItems(ctx, deps, ownerID, in.Limit)
	case genreSubjectivity:
		return listSubjectivityItems(ctx, deps, ownerID, in.Limit)
	default:
		return listOutputItems(ctx, deps, ownerID, in.Limit)
	}
}

type corpusGetArgs struct {
	Genre string `json:"genre"`
	ID    string `json:"id"`
}

func decodeCorpusGet(raw json.RawMessage) (corpusGetArgs, error) {
	var in corpusGetArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := requireGenre(in.Genre); err != nil {
		return in, err
	}
	return in, fp.RequireArgs([2]string{"id", in.ID})
}

func getCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusGet(raw)
		if perr != nil {
			return nil, perr
		}
		item, err := getByGenre(ctx, deps, ownerID, in)
		if err != nil {
			return nil, corpusErr(err)
		}
		// 边(读下一条 / 被谁引)是旁证:取不到只当没有,不该让整条详情打不开。
		refs := noteRefsOf(ctx, deps, ownerID, in.ID)
		item.Outbound, item.Backlinks = refs.Outbound, refs.Backlinks
		fillMedia(ctx, deps, ownerID, in.ID, &item)
		return json.Marshal(item)
	}
}

// fillMedia —— 把这条语料的 hero 和素材填进出参。
//
// 取不到只当没有:一份素材出问题不该让整条语料读不出来 —— 跟边那几行同一个道理。
func fillMedia(
	ctx context.Context, deps usecase.Deps, ownerID, noteID string, item *corpusItemOut,
) {
	media, ok := usecase.LoadNoteMedia(ctx, deps.Media, ownerID, noteID)
	if !ok {
		return
	}
	item.CoverHeadline, item.CoverHue = media.Hero.CoverHeadline, media.Hero.CoverHue
	if media.Hero.CoverAssetID != "" {
		cover := media.Hero.CoverAssetID
		item.CoverImageAssetID = &cover
	}
	item.AssetURLs, item.Assets = media.URLs, media.Assets
}

func getByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusGetArgs,
) (corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		return getRawItem(ctx, deps, ownerID, in.ID)
	case genreWiki:
		return getWikiItem(ctx, deps, ownerID, in.ID)
	case genreSubjectivity:
		return getSubjectivityItem(ctx, deps, ownerID, in.ID)
	default:
		return getOutputItem(ctx, deps, ownerID, in.ID)
	}
}

// noteRefsPair —— 一条 note 的两侧边。
type noteRefsPair struct {
	Outbound  []refOut
	Backlinks []refOut
}

func noteRefsOf(
	ctx context.Context, deps usecase.Deps, ownerID, id string,
) noteRefsPair {
	out, oerr := deps.NoteRefs.AdminOutboundFor(ctx, ownerID, id)
	back, berr := deps.NoteRefs.AdminBacklinksFor(ctx, ownerID, id)
	if oerr != nil || berr != nil {
		return noteRefsPair{Outbound: []refOut{}, Backlinks: []refOut{}}
	}
	return noteRefsPair{Outbound: toRefOuts(out), Backlinks: toRefOuts(back)}
}

// nonNilStrings —— nil 切片序列化成 null,调用方要的是 []。
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func toRefOuts(refs []repo.NoteRef) []refOut {
	out := make([]refOut, 0, len(refs))
	for i := range refs {
		out = append(out, refOut{ID: refs[i].ID, Title: refs[i].Title})
	}
	return out
}

// corpusErr —— 域的哨兵 → 协议无关的类别。code 是已经发出去的契约,显式钉住。
func corpusErr(err error) error {
	for _, c := range corpusErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("corpus op", err)
}

// code 全是**已经发出去的**那些(面板按 raw_not_found / sibling_name_taken 分流),
// 所以逐条钉住 —— 归一化前 MCP 那边一律回一句 "corpus entry not found",是更差的那份。
var corpusErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error { return fp.BadInput("required field is empty") }},
	{entity.ErrParentNotFound, func() error { return fp.BadInput("parent entry not found") }},
	{entity.ErrParentCycle, func() error { return fp.BadInput("parent would create a cycle") }},
	{entity.ErrSiblingSlugTaken, func() error {
		return fp.Coded(
			fp.Conflict("an entry with the same name already exists here"), "sibling_name_taken")
	}},
	{entity.ErrRawNotFound, func() error {
		return fp.Coded(fp.NotFound("raw entry not found"), "raw_not_found")
	}},
	{entity.ErrWikiNotFound, func() error {
		return fp.Coded(fp.NotFound("wiki entry not found"), "wiki_not_found")
	}},
	{entity.ErrOutputNotFound, func() error {
		return fp.Coded(fp.NotFound("output entry not found"), "output_not_found")
	}},
}

// nowRFC3339 —— 出站时间戳统一 UTC + RFC3339。
func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }
