// corpus_index_periodic.go —— this domain's periodic job: once Meili recovers, backfill
// the writes that missed indexing while it was down.
//
// This loop has always been running, but **it never once showed up on Monitor's background
// jobs panel** — it was a hand-rolled ticker, and the registration line only gets written
// by whoever remembers to write it. It now takes the same path as every other periodic
// job: the domain declares it, the host schedules and books it, so the question "what's
// running periodically in this process" holds true for it too, for the first time.

package usecase

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
)

// reconcileEvery —— after Meili recovers, backfill the down-period writes within this
// interval.
const reconcileEvery = 8 * time.Second

// SoleOwnerID —— gets this instance's owner id (a narrow port: this domain doesn't know
// the owner domain).
//
// **Returns an empty string, not an error, when the instance hasn't been claimed yet** —
// that isn't a failure, it's "nothing to rebuild". Keeping the two separate means a
// brand-new instance doesn't get a red stamp on the panel every 8 seconds, and a real
// error stays visible when it happens.
type SoleOwnerID func(ctx context.Context) (string, error)

// IndexPeriodicJobs —— the periodic jobs this domain exposes. indexer is nil (Meili not
// configured) → expose none: the panel shouldn't show a job that's always ok but does
// nothing.
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
				return nil // not claimed yet, no corpus to rebuild
			}
			indexer.Reconcile(ctx, ownerID)
			return nil
		},
	)}
}
