// retention.go —— ephemeral retention (docs/design/job-loop-retention.md). A bundle is one clock
// shared by an assessment (job loop), a microsite and the codes bound to it. 90 days after its last
// touch an unpinned bundle expires: its codes are revoked as expired, its pages go to the trash
// marked expired, and retention.bundle_cleared tells the job loop to clear its assessments.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// Retention classes, and the clock.
const (
	RetentionForever   = "forever"
	RetentionEphemeral = "ephemeral"
	// RetentionTTL —— an untouched, unpinned bundle expires this long after its last touch.
	RetentionTTL = 90 * 24 * time.Hour
	// RevokedExpired —— the revoked_reason of a code whose bundle expired.
	RevokedExpired = "expired"
)

// Retention events: the sweep's audit record, and a restore.
const (
	RetentionBundleCleared  = "retention.bundle_cleared"
	RetentionBundleRestored = "retention.bundle_restored"
)

// Retention errors the caller can act on.
var (
	ErrBadRetention        = errors.New("retention must be forever or ephemeral")
	ErrRetentionNotFound   = repo.ErrNoSuchBundle
	ErrRetentionNotCleared = errors.New("this bundle has not been cleared: nothing to restore")
)

// RetentionDeps —— the sweep, pin and restore: the clock, how to revoke a page's codes (the
// access domain's, wired at the composition root), and the outbox.
type RetentionDeps struct {
	Bundles         *repo.RetentionRepo
	RevokePageCodes func(ctx context.Context, ownerID, pageID, reason string) error
	Events          func() events.Recorder
}

// bundleCleared / bundleRestored —— the events' data.
type bundleCleared struct {
	BundleID   string   `json:"bundle_id"`
	Reason     string   `json:"reason"`
	Microsites []string `json:"microsites"`
}

type bundleRestored struct {
	BundleID string `json:"bundle_id"`
}

// RetentionEventTypes —— declared so webhooks and events.list know them.
func RetentionEventTypes() []events.Type {
	return []events.Type{{
		Type: RetentionBundleCleared,
		Description: "An ephemeral bundle ran out of time: its assessments cleared, its pages " +
			"went to the trash, its codes were revoked (data.microsites, data.reason).",
		Subject: "retention/<bundle id>", Exposure: events.Webhook,
	}, {
		Type:        RetentionBundleRestored,
		Description: "A cleared bundle was restored on a fresh clock.",
		Subject:     "retention/<bundle id>", Exposure: events.Webhook,
	}}
}

// RetentionPeriodicJobs —— the daily sweep.
func RetentionPeriodicJobs(d *RetentionDeps) []periodic.Job {
	return []periodic.Job{periodic.Named("retention sweep", 24*time.Hour,
		func(ctx context.Context) error { return SweepRetention(ctx, d, time.Now()) })}
}

// SweepRetention —— expires every due bundle; one failing bundle does not stop the others.
func SweepRetention(ctx context.Context, d *RetentionDeps, now time.Time) error {
	due, err := d.Bundles.Due(ctx, now.Add(-RetentionTTL))
	if err != nil {
		return err
	}
	errs := make([]error, 0, len(due))
	for _, b := range due {
		errs = append(errs, expireBundle(ctx, d, b))
	}
	return errors.Join(errs...)
}

// expireBundle —— codes first (idempotent), then one transaction for pages + clock + audit: a
// crash between the two converges on the next run.
func expireBundle(ctx context.Context, d *RetentionDeps, b repo.DueBundle) error {
	pages, err := d.Bundles.PageIDs(ctx, b.ID)
	if err != nil {
		return err
	}
	for _, p := range pages {
		if rerr := d.RevokePageCodes(ctx, b.OwnerID, p, RevokedExpired); rerr != nil {
			return fmt.Errorf("revoke page codes: %w", rerr)
		}
	}
	_, err = d.Bundles.Expire(ctx, b.ID, func(tx pgstore.Tx) error {
		return d.Events().With(tx).Record(ctx, b.OwnerID, RetentionBundleCleared,
			"retention/"+b.ID, bundleCleared{
				BundleID: b.ID, Microsites: pages, Reason: "ephemeral, untouched for 90 days",
			})
	})
	return err
}

// RestoreRetention —— a cleared bundle comes back on a fresh clock: its pages leave the trash and
// retention.bundle_restored brings its assessments back. Revoked codes stay revoked.
func RestoreRetention(ctx context.Context, d *RetentionDeps, ownerID, bundleID string) error {
	ok, err := d.Bundles.Restore(ctx, ownerID, bundleID, func(tx pgstore.Tx) error {
		return d.Events().With(tx).Record(ctx, ownerID, RetentionBundleRestored,
			"retention/"+bundleID, bundleRestored{BundleID: bundleID})
	})
	if err != nil {
		return err
	}
	if !ok {
		return ErrRetentionNotCleared
	}
	return nil
}

// PinRetention —— pin (the clock stops) or unpin (a fresh 90 days).
func PinRetention(
	ctx context.Context, d *RetentionDeps, ownerID, bundleID string, keep bool,
) error {
	ok, err := d.Bundles.Pin(ctx, ownerID, bundleID, keep)
	if err != nil {
		return err
	}
	if !ok {
		return ErrRetentionNotFound
	}
	return nil
}

// TouchPage —— a visit, a chat turn, a store write or an owner edit renews the page's bundle.
// Never fails its caller: a lost touch costs at most an earlier expiry, and is logged.
func TouchPage(ctx context.Context, pages *repo.MicrositeRepo, pageID string) {
	if pages == nil || pageID == "" {
		return
	}
	if err := pages.TouchBundle(ctx, pageID); err != nil {
		slog.Default().Warn("retention: touch page", "page", pageID, "err", err)
	}
}

// checkRetention —— the arguments of an ephemeral create, before anything is written.
func checkRetention(retention, bundleID string) error {
	switch retention {
	case RetentionEphemeral:
		return nil
	case "", RetentionForever:
		if bundleID == "" {
			return nil
		}
		return ErrBadRetention
	default:
		return ErrBadRetention
	}
}

// expiredPageOr —— a missing page whose ephemeral clock ran out is ErrMicrositeExpired; else err.
func expiredPageOr(
	ctx context.Context, pages *repo.MicrositeRepo, owners SoleOwnerLookup, slug string, err error,
) error {
	if errors.Is(err, entity.ErrMicrositeNotFound) && SlugExpired(ctx, pages, owners, slug) {
		return entity.ErrMicrositeExpired
	}
	return err
}

// SlugExpired —— the sole owner's page under this slug ran out of time: its URL says "expired".
func SlugExpired(
	ctx context.Context, pages *repo.MicrositeRepo, owners SoleOwnerLookup, slug string,
) bool {
	handle, err := owners.FirstHandle(ctx)
	if err != nil {
		return false
	}
	o, err := owners.GetByHandle(ctx, handle)
	if err != nil {
		return false
	}
	ok, err := pages.PageExpired(ctx, o.ID, slug)
	return err == nil && ok
}
