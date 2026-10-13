// repo_seen_retention.go —— a ledger row's clock (docs/design/job-loop-retention.md). The clock is
// a retention_bundles row, shared with any microsite on the same bundle; the job loop writes it for
// its own rows only, and owner core's sweep reads it.

package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// assessmentTrashDays —— a cleared assessment can be restored this long.
// ponytail: a constant; an instance setting when the owner wants burn-at-once.
const assessmentTrashDays = 90

type seenKey struct{ id, owner pgtype.UUID }

// applyRetention —— the lifecycle change on a row, inside the annotate transaction.
func applyRetention(
	ctx context.Context, q *db.Queries, k seenKey, rc *jobsmodel.RetentionChange,
) error {
	st, err := clockState(ctx, q, k)
	if err != nil || rc == nil {
		return err
	}
	if cerr := setClass(ctx, q, k, rc, st.BundleID.Valid); cerr != nil {
		return cerr
	}
	return pin(ctx, q, k, rc.Keep)
}

// clockState —— the row's bundle; a missing row or a cleared assessment refuses.
func clockState(ctx context.Context, q *db.Queries, k seenKey) (db.SeenClockStateRow, error) {
	st, err := q.SeenClockState(ctx, db.SeenClockStateParams{ID: k.id, OwnerID: k.owner})
	if errors.Is(err, pgx.ErrNoRows) {
		return st, jobsmodel.ErrSeenNotFound
	}
	if err != nil {
		return st, fmt.Errorf("ledger clock: %w", err)
	}
	if st.ClearedAt.Valid {
		return st, jobsmodel.ErrAssessmentCleared
	}
	return st, nil
}

// setClass —— ephemeral joins (or starts) a clock; forever ends the row's bundle.
func setClass(
	ctx context.Context, q *db.Queries, k seenKey, rc *jobsmodel.RetentionChange, hasClock bool,
) error {
	switch {
	case rc.Retention == jobsmodel.RetentionForever && hasClock:
		return q.ForgetSeenBundle(ctx, db.ForgetSeenBundleParams{ID: k.id, OwnerID: k.owner})
	case rc.Retention == jobsmodel.RetentionEphemeral && !hasClock:
		return startClock(ctx, q, k, rc.BundleID)
	}
	return nil
}

// startClock —— join the owner's live bundle, or a new one-member bundle.
func startClock(ctx context.Context, q *db.Queries, k seenKey, bundleID string) error {
	if bundleID == "" {
		return q.NewBundleForSeen(ctx, db.NewBundleForSeenParams{ID: k.id, OwnerID: k.owner})
	}
	n, err := q.JoinSeenBundle(ctx, db.JoinSeenBundleParams{
		ID: k.id, OwnerID: k.owner, BundleID: pgstore.UUIDOrNull(bundleID),
	})
	if err == nil && n == 0 {
		return jobsmodel.ErrNoSuchBundle
	}
	return err
}

func pin(ctx context.Context, q *db.Queries, k seenKey, keep *bool) error {
	if keep == nil {
		return nil
	}
	n, err := q.PinSeenBundle(ctx, db.PinSeenBundleParams{ID: k.id, OwnerID: k.owner, Keep: *keep})
	if err == nil && n == 0 {
		return jobsmodel.ErrKeepNeedsClock
	}
	return err
}

// withClocks —— each ephemeral row's keep and last touch, one query for the lot.
func withClocks(ctx context.Context, q *db.Queries, rows []jobsmodel.SeenRow) error {
	ids := make([]pgtype.UUID, 0, len(rows))
	for i := range rows {
		if rows[i].Clock != nil {
			ids = append(ids, pgstore.UUIDOrNull(rows[i].Clock.BundleID))
		}
	}
	if len(ids) == 0 {
		return nil
	}
	clocks, err := q.BundleClocks(ctx, ids)
	if err != nil {
		return fmt.Errorf("ledger clocks: %w", err)
	}
	setClocks(rows, clocks)
	return nil
}

// setClocks —— fills each row's clock; a bundle that went away between the reads means forever.
func setClocks(rows []jobsmodel.SeenRow, clocks []db.BundleClocksRow) {
	byID := make(map[string]db.BundleClocksRow, len(clocks))
	for _, c := range clocks {
		byID[pgstore.FormatUUID(c.ID)] = c
	}
	for i := range rows {
		if rows[i].Clock == nil {
			continue
		}
		c, ok := byID[rows[i].Clock.BundleID]
		if !ok {
			rows[i].Clock = nil
			continue
		}
		rows[i].Clock.Keep, rows[i].Clock.LastTouchedAt = c.Keep, c.LastTouchedAt.Time
	}
}

// ClearBundle —— retention.bundle_cleared: the bundle's assessments move to the trash.
func (r *JobSeenRepo) ClearBundle(ctx context.Context, bundleID string) error {
	err := db.New(r.pool).ClearBundleAssessments(ctx, pgstore.UUIDOrNull(bundleID))
	if err != nil {
		return fmt.Errorf("clear bundle assessments: %w", err)
	}
	return nil
}

// RestoreBundle —— retention.bundle_restored: the bundle's assessments come back.
func (r *JobSeenRepo) RestoreBundle(ctx context.Context, bundleID string) error {
	err := db.New(r.pool).RestoreBundleAssessments(ctx, pgstore.UUIDOrNull(bundleID))
	if err != nil {
		return fmt.Errorf("restore bundle assessments: %w", err)
	}
	return nil
}

// PurgeTrash —— drops cleared assessments older than the trash period.
func (r *JobSeenRepo) PurgeTrash(ctx context.Context, now time.Time) error {
	before := now.Add(-assessmentTrashDays * 24 * time.Hour)
	_, err := db.New(r.pool).PurgeAssessmentTrash(ctx,
		pgtype.Timestamptz{Time: before, Valid: true})
	if err != nil {
		return fmt.Errorf("purge assessment trash: %w", err)
	}
	return nil
}

// forgetBundle —— a commit: the posting's bundle becomes forever (inside the commit transaction).
func forgetBundle(ctx context.Context, q *db.Queries, ownerID string, keys [2]string) error {
	err := q.ForgetBundleByKeys(ctx, db.ForgetBundleByKeysParams{
		OwnerID: pgstore.UUIDOrNull(ownerID), UrlKey: keys[0], CompositeKey: keys[1],
	})
	if err != nil {
		return fmt.Errorf("forget bundle: %w", err)
	}
	return nil
}
