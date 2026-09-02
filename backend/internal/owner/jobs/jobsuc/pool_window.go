// pool_window.go — the **visible slice** handed to the owner side after one
// `jobs.fetch_new`: every job in this window of the pool, each carrying how much
// longer it lives and whether it just showed up this round.
//
// Kept separate from jobs.go's fetch flow: fetching answers "what happened upstream",
// this answers "what can the owner pick from right now". There used to be only the
// former, so asking a second time in one day came back with an empty array while
// the pool still held over two hundred live jobs (F-E-29).

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

// ListPoolBoard — **one board, shared by two surfaces**. What the owner sees when
// asking Claude "what's new today" and what they see opening /admin/listings must be
// the same data — otherwise the counts disagree, and when they disagree nothing
// says which side is wrong. since<=0 = the whole live pool.
//
// Does not mark New here: that's a concept relative to "this particular round", and
// only the fetch_new path knows it.
func ListPoolBoard(
	ctx context.Context, deps JobsDeps, ownerID string, since time.Duration,
) ([]PoolRow, error) {
	return poolWindow(ctx, deps, ownerID, since, nil)
}

// poolWindow — every job in this window of the pool, with this round's newly-pooled
// ones flagged New.
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

// crossSourceSurvivors — cross-source dedup **must also apply to this pool-side view**.
//
// The pool gets written **per source**, and cross-source dedup used to apply only to
// "what this round's call returns" (`dedup.Apply` inside FetchNewJobs) — meaning the
// same posting from two sources sits in the pool as two rows, just invisible in the
// response. Once the response is grown from the pool instead, both rows surface at
// once: **fixing one defect must not drop an invariant that was already held**.
//
// "Who wins" must be decided by **pool-entry order**, not display order: `pooled` has
// the newest first, so it's reversed before being fed to dedup (whichever entered the
// pool first is seen first, and whoever is seen first is kept) — the same rule as
// "whichever source registered first wins".
func crossSourceSurvivors(pooled []jobcache.PooledJob) map[string]bool {
	oldestFirst := make([]jobsmodel.FetchedJob, 0, len(pooled))
	// Index only: a whole PooledJob is 200 bytes, iterating by value would copy it every round.
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

// newRowsOnly — the fallback when the pool can't be read: this round's new entries
// still get handed back as usual. TTL is left blank rather than invented — a value
// that wasn't measured doesn't get written ([[empty-is-not-json-null]]).
func newRowsOnly(fresh []jobsmodel.FetchedJob) []PoolRow {
	rows := make([]PoolRow, 0, len(fresh))
	for i := range fresh {
		rows = append(rows, PoolRow{Job: fresh[i], New: true})
	}
	return rows
}
