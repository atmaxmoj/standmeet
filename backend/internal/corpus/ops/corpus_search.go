// corpus_search.go —— owner 侧的「按内容找一条」。
//
// 为什么它得存在（F-L-39/40/41）：owner 的语料有 575 条 wiki + 450 条 raw，而他这一侧原先
// 只有两个读口 —— `corpus.list`（最新的一页，上限 200，**没有 offset**）和 `corpus.get`
// （必须已经知道 id）。于是「打开我那条 good-regulator-theorem」这件事，在 owner 的 AI 客户端
// 里做不到，在 `/admin/wiki` 上也只能靠标签筛 + 用眼睛扫两列网格。
//
// 而**访客那一侧一直有搜索**（答案头上就印着 `SEARCHED 2 · READ 2`），底下 `repo.*.Search`
// 的全文检索也一直在。缺的从来不是能力，是 owner 这一侧没接线。
//
// 语义：一个 genre 内按关键词全文搜，返回跟 `corpus.list` **同一种行**（多带一个 snippet），
// 带 offset 翻页 —— 翻页在这里不是可选项：一条命中的东西够不到，跟没搜到没有区别。

package ops

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

var corpusSearchSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"genre":{"type":"string","description":"'raw' | 'wiki' | 'output' | 'subjectivity'."},
		"query":{"type":"string","description":"Words to look for in title and body."},
		"limit":{"type":"integer","description":"Max rows (default 50, max 200)."},
		"offset":{"type":"integer","description":"How many matches to skip — page with it."}
	},
	"required":["genre","query"]
}`)

// CorpusSearch —— 单独一个构造器（而不是塞进 CorpusReads）：读那一组现在有三件事，
// 分开注册让「谁提供了什么」在装配点上是看得见的。
func CorpusSearch(deps usecase.Deps) []fp.Op {
	return []fp.Op{{
		ID: "corpus.search",
		// 说明里必须写清它会漏 —— 跟访客那条 `corpus_search` 同一个理由（F-S-2）：这是一条
		// **词法**索引，`to_tsvector('english', …)` 切不动词中子串、紧贴标点的词、以及 CJK。
		// owner 的 vault 按 `> [!i18n]` 契约整段带中文，所以这不是边角情况。
		// 空结果**不等于**语料里没有，而读这句话的是 owner 的 AI —— 它据此决定要不要换个词再问。
		Description: "Find corpus entries by what they say. Full-text over title + body " +
			"inside one genre, with offset paging. Use this when you know roughly what a note " +
			"says but not its id — corpus.list only shows the newest page. This is a lexical " +
			"index: substrings inside a word, terms glued to punctuation, and CJK tokenize " +
			"badly, so an empty result does NOT mean the corpus lacks the material — retry " +
			"with a distinctive whole word before concluding it isn't there.",
		InputSchema: corpusSearchSchema,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      searchCorpus(deps),
	}}
}

type corpusSearchArgs struct {
	Genre  string `json:"genre"`
	Query  string `json:"query"`
	Limit  int32  `json:"limit"`
	Offset int32  `json:"offset"`
}

func decodeCorpusSearch(raw json.RawMessage) (corpusSearchArgs, error) {
	var in corpusSearchArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	if err := requireGenre(in.Genre); err != nil {
		return in, err
	}
	if err := fp.RequireArgs([2]string{"query", in.Query}); err != nil {
		return in, err
	}
	in.Limit = clampCorpusLimit(in.Limit)
	if in.Offset < 0 {
		in.Offset = 0
	}
	return in, nil
}

func searchCorpus(deps usecase.Deps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeCorpusSearch(raw)
		if perr != nil {
			return nil, perr
		}
		items, err := searchByGenre(ctx, deps, ownerID, in)
		if err != nil {
			return nil, corpusErr(err)
		}
		return json.Marshal(items)
	}
}

func searchByGenre(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	switch in.Genre {
	case genreRaw:
		return searchRawItems(ctx, deps, ownerID, in)
	case genreWiki:
		return searchWikiItems(ctx, deps, ownerID, in)
	case genreSubjectivity:
		return searchSubjectivityItems(ctx, deps, ownerID, in)
	default:
		return searchOutputItems(ctx, deps, ownerID, in)
	}
}

func searchRawItems(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	rows, err := deps.Raw.Search(ctx, ownerID, in.Query, in.Limit, in.Offset)
	if err != nil {
		return nil, fmt.Errorf("search raw: %w", err)
	}
	return noteMetaItems(rows, genreRaw), nil
}

func searchWikiItems(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	rows, err := deps.Wiki.Search(ctx, ownerID, in.Query, in.Limit, in.Offset)
	if err != nil {
		return nil, fmt.Errorf("search wiki: %w", err)
	}
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, wikiMetaItem(&rows[i]))
	}
	return out, nil
}

func searchOutputItems(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	rows, err := deps.Output.Search(ctx, ownerID, in.Query, in.Limit, in.Offset)
	if err != nil {
		return nil, fmt.Errorf("search output: %w", err)
	}
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, outputMetaItem(&rows[i]))
	}
	return out, nil
}

func searchSubjectivityItems(
	ctx context.Context, deps usecase.Deps, ownerID string, in corpusSearchArgs,
) ([]corpusItemOut, error) {
	rows, err := deps.Subjectivity.Search(ctx, ownerID, in.Query, in.Limit, in.Offset)
	if err != nil {
		return nil, fmt.Errorf("search subjectivity: %w", err)
	}
	return noteMetaItems(rows, genreSubjectivity), nil
}

func noteMetaItems(rows []repo.NoteMeta, genre string) []corpusItemOut {
	out := make([]corpusItemOut, 0, len(rows))
	for i := range rows {
		out = append(out, noteMetaItem(&rows[i], genre))
	}
	return out
}
