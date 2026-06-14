// visitor_chat_tools_list.go —— corpus_list tool 的执行体:wiki 树的**懒加载逐层
// 导航**。不 load 全树 —— 给 path 就 ListChildren(meta-only,DB 端,翻页)列它的
// 直接子;path 空列根层。子节点是不是叶子「现算」:LLM 拿 path 再 list 一次,空 →
// 叶子。output/writing 是扁平语料(各有自己 search/read),只在根层附上,不进 wiki 下降。
//
// 从 visitor_chat_tools.go 拆出来守 max-lines 350 cap。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// listPageLimit —— corpus_list 一层一页的上限(宽子树翻页留给 LLM 用 page)。
const listPageLimit = 50

// runList —— {path?, page?}。path 空列 wiki 根层(+ output/writing);path 指某 wiki
// 节点则列其直接子。page 0-based 翻宽层。
func (r *retriever) runList(ctx context.Context, input []byte) (string, error) {
	var args struct {
		Path string `json:"path"`
		Page int    `json:"page"`
	}
	if uerr := json.Unmarshal(input, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	return r.listResult(ctx, args.Path, args.Page), nil
}

// listResult —— 返 JSON string;path 解不出(未知地址) → friendly error 行,不 502。
func (r *retriever) listResult(ctx context.Context, path string, page int) string {
	rows, err := r.listEntries(ctx, path, page)
	if err != nil {
		return errJSON("list: " + err.Error())
	}
	return marshalRows(rows)
}

func (r *retriever) listEntries(ctx context.Context, path string, page int) ([]corpusRow, error) {
	wikiRows, err := r.listWikiChildren(ctx, path, page)
	if err != nil {
		return nil, err
	}
	if path != "" {
		return wikiRows, nil // 下降进 wiki 子树:只列 wiki 子节点
	}
	out := make([]corpusRow, 0, len(wikiRows)+len(r.outputs)+len(r.writings))
	out = append(out, wikiRows...)
	out = append(out, r.listOutputsByPrefix("")...)
	out = append(out, r.listWritingsByPrefix("")...)
	return out, nil
}

// listWikiChildren —— DB 端列 path 节点的直接子(path 空 = 根层),翻页。每个子算出
// 树派生 path + ACL,把 path→id 记进 seen 供后续 corpus_read 反查。
func (r *retriever) listWikiChildren(
	ctx context.Context, path string, page int,
) ([]corpusRow, error) {
	var parentID *string
	if path != "" {
		id, err := resolveWikiNodeID(ctx, r.wikiRepo, r.ownerID, path)
		if err != nil {
			return nil, err
		}
		parentID = &id
	}
	offset := int32(page) * listPageLimit
	kids, lerr := r.wikiRepo.ListChildren(ctx, r.ownerID, parentID, listPageLimit, offset)
	if lerr != nil {
		return nil, fmt.Errorf("list children: %w", lerr)
	}
	return r.childRows(path, kids), nil
}

func (r *retriever) childRows(parentPath string, kids []postgres.WikiMeta) []corpusRow {
	out := make([]corpusRow, 0, len(kids))
	for i := range kids {
		if row, ok := r.childRow(parentPath, &kids[i]); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) childRow(parentPath string, m *postgres.WikiMeta) (corpusRow, bool) {
	childPath := pathSegment(m.Title)
	if parentPath != "" {
		childPath = parentPath + "/" + childPath
	}
	if !r.allowsEntry(domain.GenreWiki, childPath) {
		return corpusRow{}, false
	}
	r.seen[childPath] = m.ID
	return corpusRow{Path: childPath, Title: m.Title, Genre: "wiki"}, true
}

func (r *retriever) listOutputsByPrefix(prefix string) []corpusRow {
	out := make([]corpusRow, 0, len(r.outputs))
	for i := range r.outputs {
		if row, ok := r.listOutputRow(&r.outputs[i], prefix); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) listWritingsByPrefix(prefix string) []corpusRow {
	out := make([]corpusRow, 0, len(r.writings))
	for i := range r.writings {
		if row, ok := r.listWritingRow(&r.writings[i], prefix); ok {
			out = append(out, row)
		}
	}
	return out
}

func (r *retriever) listOutputRow(o *domain.Output, prefix string) (corpusRow, bool) {
	p := r.outputPath(o)
	if !r.allowsEntry(domain.GenreOutput, p) || !strings.HasPrefix(p, prefix) {
		return corpusRow{}, false
	}
	return corpusRow{Path: p, Title: o.Title(), Genre: "output"}, true
}
