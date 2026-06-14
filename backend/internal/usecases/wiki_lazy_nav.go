// wiki_lazy_nav.go —— wiki 懒加载导航的 usecase 工具:不 load 全量,按 id 顺 parent
// 链(meta-only,GetMetaByID)算一条的树派生 path + 判 ACL。retriever 的 DB 搜/读、
// 以及 cited 反查的 path 都走这套,跟 WikiTreePaths 同款 slug。

package usecases

import (
	"context"
	"fmt"
	"strings"
)

// wikiPathByID —— 顺 parent_id 上溯算一条 wiki 的树派生 path(meta-only,不读 body)。
// 跟 WikiTreePaths 同款 slug;懒加载下不做同名兄弟去重(罕见,边缘略过)。
func wikiPathByID(
	ctx context.Context, repo WikiLister, ownerID, id string,
) (string, error) {
	segs := make([]string, 0, treeMaxDepth)
	cur := id
	for range treeMaxDepth {
		meta, err := repo.GetMetaByID(ctx, ownerID, cur)
		if err != nil {
			return "", fmt.Errorf("wiki meta walk: %w", err)
		}
		segs = append([]string{pathSegment(meta.Title)}, segs...)
		if meta.ParentID == nil {
			break
		}
		cur = *meta.ParentID
	}
	return strings.Join(segs, "/"), nil
}
