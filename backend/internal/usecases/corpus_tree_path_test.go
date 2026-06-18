// corpus_tree_path_test.go —— treePathsFor 的 slug 去重必须**与输入顺序无关**。
// bug:ListWikiByOwner 的 ORDER BY created_at DESC 没有唯一 tiebreaker —— 两条
// 同 ms 创建的 entry 在 tie 上顺序随机,两次独立 corpus_read 可能拿到不同顺序 →
// 撞车 slug 的 -2 分配翻转 → 同一 path 解析到不同 doc → 访客读 "foo-bar-2" 时而
// 命中 A 时而命中 B。修法:treePathsFor 内部按 id 定序,去重结果稳定。

package usecases

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// 两个 root,title slug 都 → "foo-bar"(撞车),仅 id 不同。
func TestTreePathsFor_StableRegardlessOfInputOrder(t *testing.T) {
	t.Parallel()
	a := pathNode{id: "id-aaa", title: "Foo Bar"}
	b := pathNode{id: "id-bbb", title: "Foo-Bar"}

	forward := treePathsFor([]pathNode{a, b})
	backward := treePathsFor([]pathNode{b, a})

	// path→id 映射必须跟输入顺序无关 —— 否则同一 path 在不同请求解析到不同 doc。
	require.Equal(t, forward, backward)
	// 两条各得各的 path(一个 base 一个 -2),互不串。
	require.NotEqual(t, forward["id-aaa"], forward["id-bbb"])
	require.Len(t, forward, 2)
}
