// wiki_lazy_nav.go —— wiki 懒加载导航的 usecase 工具:不 load 全量,按 id 顺 parent
// 链(meta-only,GetMetaByID)算一条的树派生 path + 判 ACL。retriever 的 DB 搜/读、
// 以及 cited 反查的 path 都走这套,跟 WikiTreePaths 同款 slug。

package corpus

import (
	"context"
	"fmt"
	"strings"
)

// resolveChildPageLimit —— 顺 path 下降时每层翻页拉子节点的页大小(只为定位某个
// segment,够大就行)。
const resolveChildPageLimit = 200

// WikiPathByID —— 顺 parent_id 上溯算一条 wiki 的树派生 path(meta-only,不读 body)。
// 跟 WikiTreePaths 同款 slug;懒加载下不做同名兄弟去重(罕见,边缘略过)。
func WikiPathByID(
	ctx context.Context, repo WikiLister, ownerID, id string,
) (string, error) {
	segs := make([]string, 0, TreeMaxDepth)
	cur := id
	for range TreeMaxDepth {
		meta, err := repo.GetMetaByID(ctx, ownerID, cur)
		if err != nil {
			return "", fmt.Errorf("wiki meta walk: %w", err)
		}
		segs = append([]string{PathSegment(meta.Title)}, segs...)
		if meta.ParentID == nil {
			break
		}
		cur = *meta.ParentID
	}
	return strings.Join(segs, "/"), nil
}

// OutputPathByID —— WikiPathByID 的 output 孪生:顺 parent_id 上溯算 output 的树派生
// path(meta-only,不读 body)。
func OutputPathByID(
	ctx context.Context, repo OutputLister, ownerID, id string,
) (string, error) {
	segs := make([]string, 0, TreeMaxDepth)
	cur := id
	for range TreeMaxDepth {
		meta, err := repo.GetMetaByID(ctx, ownerID, cur)
		if err != nil {
			return "", fmt.Errorf("output meta walk: %w", err)
		}
		segs = append([]string{PathSegment(meta.Title)}, segs...)
		if meta.ParentID == nil {
			break
		}
		cur = *meta.ParentID
	}
	return strings.Join(segs, "/"), nil
}

// WikiEntryPath —— 导出:一条 wiki 的树派生 path(meta-only 上溯)。corpus 写工具
// (promote_to_wiki / update_wiki)在响应里回它,让调用方拿到"东西落在哪"的地址
// (= corpus_read 的入参),不用自己从 title slug 反推。
func WikiEntryPath(
	ctx context.Context, repo WikiLister, ownerID, id string,
) (string, error) {
	return WikiPathByID(ctx, repo, ownerID, id)
}

// OutputEntryPath —— WikiEntryPath 的 output 孪生(promote_wiki_to_output / update_output 用)。
func OutputEntryPath(
	ctx context.Context, repo OutputLister, ownerID, id string,
) (string, error) {
	return OutputPathByID(ctx, repo, ownerID, id)
}

// ResolveWikiNodeID —— 把一条**非空**树派生 path 顺 root→下逐层解成它的节点 id(不
// load 全树:每层 ListChildren meta-only,按 PathSegment(title) 匹配 segment)。任一段
// 无匹配 → ErrWikiNotFound。根层(path 空)由调用方直接用 nil parentID,不进这里。
func ResolveWikiNodeID(
	ctx context.Context, repo WikiLister, ownerID, path string,
) (string, error) {
	var parentID *string
	id := ""
	for seg := range strings.SplitSeq(path, "/") {
		found, err := findChildBySegment(ctx, repo, ownerID, parentID, seg)
		if err != nil {
			return "", err
		}
		id = found
		parentID = &id
	}
	return id, nil
}

// findChildBySegment —— 在 parentID 的直接子里翻页找 PathSegment(title)==seg 的那个,
// 返其 id。翻完没有 → ErrWikiNotFound。
func findChildBySegment(
	ctx context.Context, repo WikiLister, ownerID string, parentID *string, seg string,
) (string, error) {
	for offset := int32(0); ; offset += resolveChildPageLimit {
		kids, err := repo.ListChildren(ctx, ownerID, parentID, resolveChildPageLimit, offset)
		if err != nil {
			return "", fmt.Errorf("list children: %w", err)
		}
		if id, ok := segInPage(kids, seg); ok {
			return id, nil
		}
		if len(kids) < resolveChildPageLimit {
			return "", ErrWikiNotFound
		}
	}
}

// segInPage —— 一页 children 里找 PathSegment(title)==seg 的那个,返其 id。
func segInPage(kids []WikiMeta, seg string) (string, bool) {
	for i := range kids {
		if PathSegment(kids[i].Title) == seg {
			return kids[i].ID, true
		}
	}
	return "", false
}

// resolveOutputNodeID —— ResolveWikiNodeID 的 output 孪生(output 跟 wiki 同构,都是
// 带 parent_id 的树);顺 root→下逐层 ListChildren meta-only 解 path→id。
func resolveOutputNodeID(
	ctx context.Context, repo OutputLister, ownerID, path string,
) (string, error) {
	var parentID *string
	id := ""
	for seg := range strings.SplitSeq(path, "/") {
		found, err := findOutputChildBySegment(ctx, repo, ownerID, parentID, seg)
		if err != nil {
			return "", err
		}
		id = found
		parentID = &id
	}
	return id, nil
}

func findOutputChildBySegment(
	ctx context.Context, repo OutputLister, ownerID string, parentID *string, seg string,
) (string, error) {
	for offset := int32(0); ; offset += resolveChildPageLimit {
		kids, err := repo.ListChildren(ctx, ownerID, parentID, resolveChildPageLimit, offset)
		if err != nil {
			return "", fmt.Errorf("list output children: %w", err)
		}
		if id, ok := segInOutputPage(kids, seg); ok {
			return id, nil
		}
		if len(kids) < resolveChildPageLimit {
			return "", ErrOutputNotFound
		}
	}
}

func segInOutputPage(kids []OutputMeta, seg string) (string, bool) {
	for i := range kids {
		if PathSegment(kids[i].Title) == seg {
			return kids[i].ID, true
		}
	}
	return "", false
}
