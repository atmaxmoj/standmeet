// uc_corpus_index_periodic.go —— 本域的周期任务:Meili 恢复后补齐 down 期间漏索引的写。
//
// 这个循环一直在跑,但**从来没有出现在 Monitor 的后台任务面板上** —— 它是手写的 ticker,
// 而登记那一句只有记得写的人才会写。现在它跟别的周期任务同一条路:域声明,宿主调度并簿记,
// 于是"这进程里有什么在定期跑"这个问题第一次对它也成立。

package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// reconcileEvery —— Meili 恢复后,这个间隔内把 down 期间的写补上。
const reconcileEvery = 8 * time.Second

// SoleOwnerID —— 拿本实例那个 owner 的 id(窄口:本域不认识 owner 域)。
//
// **实例还没被 claim 时返回空串,不是 error** —— 那不是失败,是没有可重建的东西。两者分开,
// 面板上才不会给一台崭新的实例每 8 秒盖一个红章;真出错时也才看得见。
type SoleOwnerID func(ctx context.Context) (string, error)

// IndexPeriodicJobs —— 本域开出去的周期任务。indexer 为 nil(未配 Meili)→ 一件也不开:
// 面板上不该出现一个永远 ok 却什么都没做的任务。
func IndexPeriodicJobs(indexer Indexer, soleOwner SoleOwnerID) []periodic.Job {
	if indexer == nil || soleOwner == nil {
		return []periodic.Job{}
	}
	return []periodic.Job{periodic.Named(
		"corpus index reconcile", reconcileEvery,
		func(ctx context.Context) error {
			ownerID, err := soleOwner(ctx)
			if err != nil {
				return fmt.Errorf("corpus index reconcile: %w", err)
			}
			if ownerID == "" {
				return nil // 还没 claim,没有可重建的语料
			}
			indexer.Reconcile(ctx, ownerID)
			return nil
		},
	)}
}
