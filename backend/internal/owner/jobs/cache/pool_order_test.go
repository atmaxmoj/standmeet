// pool_order_test.go —— the pool has to remember the order it was written in.
//
// Two surfaces read this one pool — the owner's MCP receipt and /admin/listings — and both
// apply cross-source dedup, which keeps whichever copy of a duplicate posting it sees
// first. So "which copy survives" is decided by the order ListWindow hands back, and if
// that order is not a fact about the writes, the two surfaces answer differently about the
// same pool. That is what happened: the sort key was the remaining TTL, which is identical
// for everything one fetch wrote, and the stable sort then left the ties in Redis SCAN
// order.

package cache_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// testOwner — one owner throughout; the pool is keyed per owner and none of these
// properties is about crossing owners.
const testOwner = "o1"

// rereads — how many extra times a pool is read back when asserting the order does not
// move between reads. One re-read would catch a coin flip only half the time.
const rereads = 6

// batch — eight jobs, written in this order.
var batch = []string{"a", "b", "c", "d", "e", "f", "g", "h"}

func newTestPool(t *testing.T) *cache.Pool {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	return cache.New(redis.NewClient(&redis.Options{Addr: mr.Addr()}), time.Hour)
}

func putBatch(t *testing.T, p *cache.Pool, titles ...string) []jobsmodel.FetchedJob {
	t.Helper()
	jobs := make([]jobsmodel.FetchedJob, 0, len(titles))
	for _, title := range titles {
		jobs = append(jobs, jobsmodel.FetchedJob{Title: title, URL: "https://x/" + title})
	}
	out, err := p.Put(context.Background(), testOwner, jobs)
	require.NoError(t, err)
	return out
}

// TestPutOrderIsRecoverableFromTheIDs —— the ids a single Put hands out increase in the
// order it was given the jobs, so sorting by id IS sorting by when a job entered the pool.
//
// RED on the old code: cache ids were 12 random bytes, so the pool held no record of its
// own write order at all and this comes out sorted at chance.
func TestPutOrderIsRecoverableFromTheIDs(t *testing.T) {
	t.Parallel()

	got := putBatch(t, newTestPool(t), "first", "second", "third", "fourth", "fifth")
	ids := make([]string, 0, len(got))
	for i := range got {
		ids = append(ids, got[i].CacheID)
	}
	require.True(t, slices.IsSorted(ids), "ids must ascend in write order, got %v", ids)
	require.Len(t, slices.Compact(slices.Clone(ids)), len(ids), "ids must be distinct")
}

// TestListWindowOrderIsTotalAndStable —— two reads of one pool return the same order, and
// that order is newest-written first.
//
// The "same order twice" half is the defect as it was observed: one pool, two surfaces,
// two different survivors of the same duplicate. The "newest first" half is what the
// panel promises; without it a total order could still be the wrong one.
func TestListWindowOrderIsTotalAndStable(t *testing.T) {
	t.Parallel()

	p := newTestPool(t)
	ctx := context.Background()
	putBatch(t, p, batch...)

	read := func() []string {
		rows, err := p.ListWindow(ctx, testOwner, 0)
		require.NoError(t, err)
		out := make([]string, 0, len(rows))
		for i := range rows {
			out = append(out, rows[i].Job.CacheID)
		}
		return out
	}

	first := read()
	require.Len(t, first, len(batch))
	for i := range rereads {
		require.Equal(t, first, read(), "read %d disagreed with the first read", i+2)
	}

	descending := slices.Clone(first)
	slices.Reverse(descending)
	require.True(t, slices.IsSorted(descending), "ListWindow must be newest-written first")
}

// TestSecondBatchSortsAfterTheFirst —— order holds ACROSS fetches, not just inside one.
//
// Within one batch the old TTLs tied; across two batches seconds apart they no longer do,
// which is exactly why the defect looked intermittent rather than constant.
func TestSecondBatchSortsAfterTheFirst(t *testing.T) {
	t.Parallel()

	p := newTestPool(t)
	early := putBatch(t, p, "early-1", "early-2")
	late := putBatch(t, p, "late-1", "late-2")

	for i := range early {
		for j := range late {
			require.Less(t, early[i].CacheID, late[j].CacheID,
				"a later write must carry a larger id")
		}
	}
}
