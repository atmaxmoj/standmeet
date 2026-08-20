// pool_window.go —— 一次 `jobs.fetch_new` 交给 owner 那一侧的**看得见的那一份**：
// 池子里这个窗口的全部 job，每条带着它还能活多久、以及这一趟是不是刚出现的。
//
// 跟 jobs.go 的抓取流程分开：抓取回答的是「上游发生了什么」，这里回答的是
// 「owner 现在能挑哪些」。以前只有前者，于是一天里问第二次拿回的是空数组，
// 而池子里躺着两百多条活的（F-E-29）。

package jobsuc

import (
	"context"
	"fmt"
	"slices"
	"time"

	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/dedup"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// ListPoolBoard —— **一块板子，两个面共用**。owner 在 Claude 里问「今天有什么」，
// 和他打开 /admin/listings，看到的必须是同一份 —— 否则两边条数对不上，而
// 对不上的时候没有一处说得清是哪边错了。since<=0 = 整个活池子。
//
// 这里不标 New：那是「跟这一趟比」才有的概念，只有 fetch_new 那条路知道。
func ListPoolBoard(
	ctx context.Context, deps JobsDeps, ownerID string, since time.Duration,
) ([]PoolRow, error) {
	return poolWindow(ctx, deps, ownerID, since, nil)
}

// poolWindow —— 池子里这个窗口的全部 job，并把这一趟新进池子的那些标上 New。
func poolWindow(
	ctx context.Context, deps JobsDeps, ownerID string,
	since time.Duration, fresh []jobsmodel.FetchedJob,
) ([]PoolRow, error) {
	pooled, err := deps.Cache.ListWindow(ctx, ownerID, since)
	if err != nil {
		return nil, fmt.Errorf("list job pool: %w", err)
	}
	isNew := make(map[string]bool, len(fresh))
	for i := range fresh {
		isNew[fresh[i].CacheID] = true
	}
	surfaced := crossSourceSurvivors(pooled)
	rows := make([]PoolRow, 0, len(pooled))
	for i := range pooled {
		if !surfaced[pooled[i].Job.CacheID] {
			continue
		}
		rows = append(rows, PoolRow{
			Job:          pooled[i].Job,
			TTLRemaining: pooled[i].TTLRemaining,
			New:          isNew[pooled[i].Job.CacheID],
		})
	}
	return rows, nil
}

// crossSourceSurvivors —— 跨源去重**也要作用在池子这一面**。
//
// 池子是**按源**写进去的，跨源去重以前只作用在"这一趟返回的那份"上（`dedup.Apply`
// 在 FetchNewJobs 里）—— 也就是说同一条 posting 从两个源来，池子里躺着两份，
// 只是回执里看不见。回执一改成从池子长出来，那两份就会同时冒出来：
// **修一个缺陷不能把另一个已经守住的不变量放掉**。
//
// 判"谁先赢"要按**入池先后**，不是按显示顺序：`pooled` 是新的排在前面，
// 所以先倒过来喂给 dedup（先入池的先见到、先见到的留下），跟当初
// 「先注册的源先赢」是同一条规矩。
func crossSourceSurvivors(pooled []jobcache.PooledJob) map[string]bool {
	oldestFirst := make([]jobsmodel.FetchedJob, 0, len(pooled))
	// 只取下标：整条 PooledJob 有 200 字节，按值迭代等于每轮抄一遍。
	for i := range slices.Backward(pooled) {
		oldestFirst = append(oldestFirst, pooled[i].Job)
	}
	kept := dedup.Apply(oldestFirst)
	out := make(map[string]bool, len(kept))
	for i := range kept {
		out[kept[i].CacheID] = true
	}
	return out
}

// newRowsOnly —— 读不到池子时的退路：这一趟的新条目照常交出去。
// TTL 留空而不是编一个 —— 没测到的量不写数（[[empty-is-not-json-null]]）。
func newRowsOnly(fresh []jobsmodel.FetchedJob) []PoolRow {
	rows := make([]PoolRow, 0, len(fresh))
	for i := range fresh {
		rows = append(rows, PoolRow{Job: fresh[i], New: true})
	}
	return rows
}
