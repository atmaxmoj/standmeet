// sync_ambiguity.go —— 「这个标题指得准吗」。
//
// reconcile 默认按 title 跨 genre 认领,那正是 move 得以**就地**发生的原因(wiki/x.md 改到
// subjectivity/x.md,同一行改 genre,而不是删一条建一条)。代价是:标题一旦不唯一,按 title 认
// 就是抓阄 —— `GetNoteByTitleAnyGenre` 拿的是最老的那条。
//
// 判据在**语料**,不在这一批上传(F-L-61)。这里以前只数上传树里的碰撞:整份传的时候两条同名
// 文件都在,数得出来;而 owner 只传其中一条时,这一批里那个标题唯一,于是按 title 认领 ——
// 认到了另一个 genre 里那条同名的、这次根本没上传的笔记,把它 UPDATE 成了本次上传的 genre。
// prod 上量到的代价:一次两文件的子集上传,`raw 482→479 · wiki 575→578`,回执还说 deleted 0。
// genre 就是访客 ACL 授权的边界,raw 是私料 —— 一次部分喂入把三条私料搬到了已发布那一侧。
//
// 上传树里的碰撞仍要数:两条同名的新文件同一批进来时,语料里还没有它们(F-L-2)。

package obsidian

import (
	"context"
	"fmt"
	"strings"
)

// ambiguousTitles —— 这次 reconcile 里「不能按 title 认领」的标题集合(小写)。
// 语料里已经重名的 ∪ 这批上传里自己撞名的。
func ambiguousTitles(
	ctx context.Context, deps *SyncDeps, ownerID string, tree []*desiredNode,
) (map[string]bool, error) {
	dup := collidingTitles(tree)
	existing, err := deps.Notes.DuplicateTitles(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("corpus duplicate titles: %w", err)
	}
	for _, t := range existing {
		dup[strings.ToLower(t)] = true
	}
	return dup, nil
}

// collidingTitles —— titles shared by more than one node in THIS upload.
func collidingTitles(tree []*desiredNode) map[string]bool {
	seen := map[string]int{}
	for _, n := range tree {
		seen[strings.ToLower(n.title)]++
	}
	dup := map[string]bool{}
	for title, count := range seen {
		if count > 1 {
			dup[title] = true
		}
	}
	return dup
}
