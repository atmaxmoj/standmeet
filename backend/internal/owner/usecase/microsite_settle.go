// microsite_settle.go —— a build settles (docs/design/event-bus-outbox-webhooks.md, *Phase 4*,
// inventory #14–#16).
//
// The builder reports built / failed. The build row's update, the `microsite.build.settled` event
// and a NOTIFY keyed by the owner commit in one transaction: the event exists if and only if the
// settle committed. What follows a settle is the event's subscribers' work (auto-publishing the
// home page, recomputing asset references), run as durable jobs — never inline in the builder's
// request, where a restart lost it. The NOTIFY wakes the owner's preview long-poll in whichever
// process holds it.

package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// MicrositeBuildSettled —— a build reached built or failed. Thin: subject microsite/<slug>, data
// {build_id, status}.
const MicrositeBuildSettled = "microsite.build.settled"

// BuildSettledChannel —— the NOTIFY channel a settle wakes; the payload is the owner id.
const BuildSettledChannel = "standmeet_build_settled"

// Build statuses a builder may report.
const (
	BuildBuilt  = "built"
	BuildFailed = "failed"
)

// ErrBadBuildStatus —— a report that is neither built nor failed.
var ErrBadBuildStatus = errors.New("status must be built|failed")

// MicrositeEventTypes —— the microsite event types this domain owns.
func MicrositeEventTypes() []events.Type {
	return []events.Type{{
		Type:        MicrositeBuildSettled,
		Description: "A microsite build finished: data.status is built or failed (data.build_id).",
		Subject:     "microsite/<slug>",
		Exposure:    events.Webhook,
	}}
}

// BuildSettleDeps —— the rows a settle writes and the outbox it records into.
type BuildSettleDeps struct {
	Builds *repo.MicrositeBuildRepo
	Pages  *repo.MicrositeRepo
	Events events.Recorder
}

// BuildReport —— what the builder reports for one build.
type BuildReport struct {
	ID           string
	Status       string // BuildBuilt | BuildFailed
	OutputPath   string
	ErrorMessage string
}

// SettleBuild —— marks the build, records microsite.build.settled and notifies the owner's
// waiters, in one transaction. A build whose row is gone is ErrMicrositeBuildNotFound.
func SettleBuild(ctx context.Context, d BuildSettleDeps, rep *BuildReport) error {
	if rep.Status != BuildBuilt && rep.Status != BuildFailed {
		return ErrBadBuildStatus
	}
	//nolint:wrapcheck // InTx names begin/commit; the steps name themselves
	return pgstore.InTx(ctx, d.Builds.Pool(), func(tx pgstore.Tx) error {
		return settleIn(ctx, tx, d, rep)
	})
}

// settleIn —— the settle's three writes, on tx.
//
//nolint:wrapcheck // the repo, Record and Notify name their steps
func settleIn(ctx context.Context, tx pgstore.Tx, d BuildSettleDeps, rep *BuildReport) error {
	b, err := markSettled(ctx, d.Builds.With(tx), rep)
	if err != nil {
		return err
	}
	page, err := d.Pages.GetByID(ctx, b.PageID)
	if err != nil {
		return fmt.Errorf("settle: page of build: %w", err)
	}
	data := map[string]string{"build_id": b.ID, "status": b.Status}
	err = d.Events.With(tx).Record(ctx, page.OwnerID, MicrositeBuildSettled,
		"microsite/"+page.Slug, data)
	if err != nil {
		return err
	}
	return pgstore.Notify(ctx, tx, BuildSettledChannel, page.OwnerID)
}

//nolint:wrapcheck // the repo names its step
func markSettled(
	ctx context.Context, builds *repo.MicrositeBuildRepo, rep *BuildReport,
) (entity.MicrositeBuild, error) {
	if rep.Status == BuildBuilt {
		return builds.MarkBuilt(ctx, rep.ID, rep.OutputPath)
	}
	return builds.MarkFailed(ctx, rep.ID, rep.ErrorMessage)
}

// BuildWaitDeps —— the settle version's rows, and the listener BuildSettledChannel wakes.
type BuildWaitDeps struct {
	Builds  *repo.MicrositeBuildRepo
	Settled *pgstore.Listener
}

// AwaitBuildSettled —— the preview long-poll: returns the owner's settle version at once when it
// already moved past since; otherwise waits up to maxWait for a settle of this owner's build.
// A wake always returns a version past since (the woken panel must refetch, even when a
// concurrent settle's clock read landed at or below its cursor). When the waiter cap is reached
// the request simply holds until maxWait and answers the version it read.
func AwaitBuildSettled(
	ctx context.Context, d BuildWaitDeps, ownerID string, since int64, maxWait time.Duration,
) (int64, error) {
	w, _ := d.Settled.Register(ownerID) // before the read: a settle in between still wakes it
	defer w.Release()
	builds := d.Builds
	cur, err := builds.SettleVersion(ctx, ownerID)
	if err != nil || cur > since {
		return cur, err //nolint:wrapcheck // the repo names its step
	}
	timer := time.NewTimer(maxWait)
	defer timer.Stop()
	if !w.Await(ctx, timer.C) {
		return cur, nil
	}
	next, err := builds.SettleVersion(ctx, ownerID)
	return max(next, since+1), err
}
