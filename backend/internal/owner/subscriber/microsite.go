// microsite.go —— what follows a settled build (docs/design/event-bus-outbox-webhooks.md,
// inventory #14, #15). Both were inline calls in the builder's report request: a failure was only
// logged, and a restart between the settle and the call lost it. Now each is a subscription on
// microsite.build.settled, run as a durable job with retries. Both are idempotent: they read the
// current rows and write the state those rows call for.
//
//   - microsite.homepage_publish: the reserved home page goes live the moment its first build is
//     built (a no-op for any other page, and for a home page that is already live).
//   - microsite.asset_refs: the page's pool-asset references are recomputed from its latest built
//     source, so the delete guard protects an asset a page embeds.

package subscriber

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// The subscriptions (and job kinds) on microsite.build.settled.
const (
	HomepagePublishSubscriber = "microsite.homepage_publish"
	AssetRefsSubscriber       = "microsite.asset_refs"
)

const (
	settledAttempts = 10
	settledTimeout  = 30 * time.Second
)

// AssetRefRebuilder —— recomputes a microsite's pool-asset references from its built source. The
// corpus domain owns the asset rows; the composition root injects this.
type AssetRefRebuilder func(
	ctx context.Context, ownerID, micrositeID string, sources map[string]string,
) error

// BuildSettledDeps —— the rows the handlers read, and the corpus-side rebuild.
type BuildSettledDeps struct {
	Pages            *repo.MicrositeRepo
	Builds           *repo.MicrositeBuildRepo
	Log              *slog.Logger
	RebuildAssetRefs AssetRefRebuilder
	Events           events.Recorder // the home page's auto-publish records page.promoted_live
}

type settledRun func(context.Context, *BuildSettledDeps, *entity.MicrositeBuild) error

// BuildSettledSubscriptions —— the two subscriptions on microsite.build.settled.
func BuildSettledSubscriptions(d *BuildSettledDeps) []events.Subscription {
	sub := func(name string, run settledRun) events.Subscription {
		return events.Subscription{
			Name: name, Types: []string{usecase.MicrositeBuildSettled},
			Queue: jobs.QueueIndex, MaxAttempts: settledAttempts, Timeout: settledTimeout,
			Handle: func(ctx context.Context, ev events.Event) error {
				b, err := builtBuild(ctx, d, &ev)
				if errors.Is(err, errNotBuilt) {
					return nil
				}
				if err != nil {
					return err
				}
				return run(ctx, d, &b)
			},
		}
	}
	return []events.Subscription{
		sub(HomepagePublishSubscriber, publishHomepage),
		sub(AssetRefsSubscriber, rebuildAssetRefs),
	}
}

// errNotBuilt —— the build settled failed, or it is gone (its page was deleted): nothing to do.
var errNotBuilt = errors.New("build not built")

// builtBuild —— the event's build when it settled built; errNotBuilt otherwise.
func builtBuild(
	ctx context.Context, d *BuildSettledDeps, ev *events.Event,
) (entity.MicrositeBuild, error) {
	id, err := builtID(ev)
	if err != nil {
		return entity.MicrositeBuild{}, err
	}
	b, err := d.Builds.GetByID(ctx, id)
	if errors.Is(err, entity.ErrMicrositeBuildNotFound) {
		return b, errNotBuilt
	}
	if err != nil {
		return b, fmt.Errorf("settled build: %w", err)
	}
	return b, nil
}

// builtID —— the event's build id when it settled built; errNotBuilt when it failed.
func builtID(ev *events.Event) (string, error) {
	var data struct {
		BuildID string `json:"build_id"`
		Status  string `json:"status"`
	}
	if err := json.Unmarshal(ev.Data, &data); err != nil || data.BuildID == "" {
		return "", jobs.Discard(fmt.Errorf("%s: unreadable event data %s", ev.Type, ev.Data))
	}
	if data.Status != usecase.BuildBuilt {
		return "", errNotBuilt
	}
	return data.BuildID, nil
}

// publishHomepage —— idempotent: AutopublishHomepageOnBuilt acts only while the home page is not
// yet live.
func publishHomepage(ctx context.Context, d *BuildSettledDeps, b *entity.MicrositeBuild) error {
	md := usecase.MicrositeDeps{
		Pages: d.Pages, Builds: d.Builds, Events: func() events.Recorder { return d.Events },
	}
	return usecase.AutopublishHomepageOnBuilt(ctx, md, b, d.Log)
}

// rebuildAssetRefs —— from the page's LATEST built source, not the event's build: an older event
// retried after a newer build must not bring back the older build's references.
func rebuildAssetRefs(ctx context.Context, d *BuildSettledDeps, b *entity.MicrositeBuild) error {
	if d.RebuildAssetRefs == nil {
		return nil
	}
	page, err := d.Pages.GetByID(ctx, b.PageID)
	if errors.Is(err, entity.ErrMicrositeNotFound) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("asset refs: page: %w", err)
	}
	latest, err := d.Builds.GetLatestBuiltForPage(ctx, b.PageID)
	if err != nil {
		return fmt.Errorf("asset refs: latest build: %w", err)
	}
	return d.RebuildAssetRefs(ctx, page.OwnerID, page.ID, latest.SourceFiles)
}
