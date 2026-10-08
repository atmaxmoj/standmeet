// periodic.go — builds the event bus and the job runtime, and starts them.
//
// Every domain declares its event types, subscriptions, job kinds and periodic jobs as data;
// this file only collects them — one line per source — and hands them to the two runtimes.
// Nothing here says what a job does.
//
// Order at boot: BuildBackground runs before the dispatcher is assembled (the Tasks ops and the
// corpus write receipts need the runtime), StartBackground runs last, once every block has
// registered. Stop order at shutdown: the relay first, then the workers (graceful, see
// jobsriver.Options.StopGrace).

package wire

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/cmd/server/blockwire"
	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/cmd/server/port"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	"github.com/atmaxmoj/standmeet/internal/infra/periodic"
	supplierjob "github.com/atmaxmoj/standmeet/internal/infra/sideeffect/supplier"
	monitor "github.com/atmaxmoj/standmeet/internal/monitor/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	security "github.com/atmaxmoj/standmeet/internal/security/facade"
	stats "github.com/atmaxmoj/standmeet/internal/stats/facade"
)

// BuildBackground — the bus and the job runtime, built (not started).
func BuildBackground(d *deps.Runtime) error {
	hooks := webhookDeliveryDeps(d)
	types := collectEventTypes(d)
	bus, err := events.New(d.DB, types, collectSubscriptions(d, hooks, types))
	if err != nil {
		return fmt.Errorf("event bus: %w", err)
	}
	bus.SetLogger(d.Log)
	kinds := append(bus.Kinds(), collectJobKinds(d, hooks)...)
	periodics := append(toPeriodics(collectPeriodicJobs(d)), bus.Periodics()...)
	rt, err := jobsriver.New(d.DB, kinds, periodics, jobsriver.Options{Log: d.Log})
	if err != nil {
		return fmt.Errorf("job runtime: %w", err)
	}
	d.Events, d.Jobs = bus, rt
	d.IndexReceipt = corpus.NewIndexReceipt(d.CorpusIndexer, bus, rt)
	return nil
}

// JobsQueue —— the job runtime, read at call time: a module built before BuildBackground points
// at it through this.
func JobsQueue(d *deps.Runtime) func() jobs.Runtime {
	return func() jobs.Runtime { return d.Jobs }
}

// EventsRecorder —— the outbox writer, read at call time (see JobsQueue).
func EventsRecorder(d *deps.Runtime) func() events.Recorder {
	return func() events.Recorder { return d.Events.Recorder() }
}

// StartBackground — starts the workers and the relay, then enqueues the boot-time index rebuild.
func StartBackground(ctx context.Context, d *deps.Runtime) error {
	if err := d.Jobs.Start(ctx); err != nil {
		return fmt.Errorf("start jobs: %w", err)
	}
	d.Events.Start(ctx, d.Jobs)
	go d.BuildSettled.Run(ctx) // the preview long-poll's LISTEN; ends with ctx
	go d.StoreChanged.Run(ctx) // open pages' store streams; ends with ctx
	if d.CorpusIndexer != nil {
		if _, err := corpus.EnqueueReindex(ctx, d.Jobs, soleOwnerID(d)); err != nil {
			d.Log.Warn("enqueue boot reindex", "err", err)
		}
	}
	return nil
}

// StopBackground — the relay, then the workers.
func StopBackground(ctx context.Context, d *deps.Runtime) {
	if d.Events != nil {
		d.Events.Stop()
	}
	if d.Jobs != nil {
		if err := d.Jobs.Stop(ctx); err != nil {
			d.Log.Warn("stop jobs", "err", err)
		}
	}
}

// collectEventTypes — one line per source.
func collectEventTypes(d *deps.Runtime) []events.Type {
	return append(DeclaredEventTypes(), d.JobsModule.EventTypes()...)
}

// DeclaredEventTypes — every event type a domain declares, one line per source (the job loop's
// come from its plugin, see collectEventTypes).
func DeclaredEventTypes() []events.Type {
	out := corpus.EventTypes()
	out = append(out, corpus.WritingEventTypes()...)
	out = append(out, owner.WebhookEventTypes()...)
	out = append(out, access.EventTypes()...)
	out = append(out, conversation.EventTypes()...)
	out = append(out, owner.BookingEventTypes()...)
	out = append(out, owner.MicrositeEventTypes()...)
	out = append(out, owner.OwnerEventTypes()...)
	out = append(out, security.EventTypes()...)
	out = append(out, stats.EventTypes()...)
	out = append(out, blockwire.EventTypes()...)
	return out
}

// collectSubscriptions — one line per source. The webhook fan-out subscribes to every declared
// type whose Exposure is Webhook.
func collectSubscriptions(
	d *deps.Runtime, hooks *owner.WebhookDeliveryDeps, types []events.Type,
) []events.Subscription {
	out := corpus.EventSubscriptions(d.CorpusIndexer)
	out = append(out, owner.WebhookSubscriptions(hooks, types)...)
	out = append(out, owner.NotifySubscriptions(notifyDeliveryDeps(d), types)...)
	out = append(out, owner.MailSubscriptions(mailDeps(d))...)
	out = append(out, owner.BuildSettledSubscriptions(buildSettledDeps(d))...)
	return out
}

// buildSettledDeps —— what follows a settled build reads the microsite rows; the asset-reference
// rebuild is the corpus domain's (it owns the asset rows).
func buildSettledDeps(d *deps.Runtime) *owner.BuildSettledDeps {
	return &owner.BuildSettledDeps{
		Pages: d.MicrositeRepo, Builds: d.MicrositeBuildRepo, Log: d.Log, Events: d.Recorder(),
		RebuildAssetRefs: func(
			ctx context.Context, ownerID, micrositeID string, sources map[string]string,
		) error {
			return corpus.RebuildMicrositeAssetRefs(ctx, d.AssetRepo, ownerID, micrositeID, sources)
		},
	}
}

// collectJobKinds — one line per source.
func collectJobKinds(d *deps.Runtime, hooks *owner.WebhookDeliveryDeps) []jobs.Kind {
	out := corpus.JobKinds(d.CorpusIndexer)
	out = append(out, owner.WebhookJobKinds(hooks)...)
	out = append(out, owner.NotifyJobKinds(notifyDeliveryDeps(d))...)
	out = append(out, owner.MailJobKinds(mailDeps(d))...)
	out = append(out, supplierjob.Kinds(d.BlockDispatch)...)
	out = append(out, d.JobsModule.JobKinds()...)
	return out
}

// mailDeps — the owner domain's mail jobs read the rows they need and send through the mail
// side-effect port.
func mailDeps(d *deps.Runtime) *owner.MailDeps {
	return &owner.MailDeps{
		Reqs: d.AccessRequestRepo, Codes: d.CodeRepo, Owners: d.OwnerRepo,
		Log: d.Log, Mail: port.MailSender(d), Events: d.Recorder(),
	}
}

// webhookDeliveryDeps — the job runtime and the bus are read at run time: both are built after
// the declarations that point at them.
func webhookDeliveryDeps(d *deps.Runtime) *owner.WebhookDeliveryDeps {
	return owner.NewWebhookDeliveryDeps(&owner.WebhookDeliveryDeps{
		Repo: d.OwnerRepo, Pool: d.DB, Secrets: d.WebhookSecrets, Embeds: embedAdmits(d),
		Jobs: func() jobs.Jobs { return d.Jobs },
		Event: func(ctx context.Context, id string) (events.Event, error) {
			return d.Events.Get(ctx, id)
		},
	})
}

// embedAdmits —— an embed-attached endpoint's scope: the access domain's answer for the embed's
// code, read on every event.
func embedAdmits(d *deps.Runtime) owner.WebhookEmbedAdmits {
	sd := access.EmbedScopeDeps{
		Embeds: d.EmbedRepo, Codes: d.CodeRepo, Denials: d.CodeDenialRepo, Roles: d.RoleRepo,
	}
	return func(ctx context.Context, ownerID, embedID, uri string, pub bool) (bool, error) {
		entry := access.CorpusEntryRef{URI: uri, Published: pub}
		return access.EmbedAdmits(ctx, sd, ownerID, embedID, entry)
	}
}

// collectPeriodicJobs — one line per source.
func collectPeriodicJobs(d *deps.Runtime) []periodic.Job {
	out := d.JobsModule.PeriodicJobs()
	out = append(out, stats.UsagePeriodicJobs(d.InferenceUsageRepo)...)
	out = append(out, owner.GasRefillPeriodicJobs(d.OwnerRepo, d.Recorder())...)
	out = append(out, conversation.PrunePeriodicJobs(d.ChatRepo, d.Log, d.Recorder())...)
	out = append(out, monitor.PeriodicJobs(d.MonitorRepo)...)
	out = append(out, corpus.TrashPeriodicJobs(corpus.NewTrashRepo(d.DB))...)
	if d.SandboxWorkspaces != nil {
		out = append(out, d.SandboxWorkspaces.PeriodicJobs()...)
	}
	return out
}

func toPeriodics(in []periodic.Job) []jobs.Periodic {
	out := make([]jobs.Periodic, 0, len(in))
	for _, p := range in {
		out = append(out, jobs.Periodic{Name: p.Name, Every: p.Every, Run: p.Run})
	}
	return out
}

// soleOwnerID — translates the owner domain's "this instance's owner" into the narrow port
// corpus understands. Not-yet-claimed translates to "" (nothing to index), not an error.
func soleOwnerID(d *deps.Runtime) corpus.SoleOwnerID {
	return func(ctx context.Context) (string, error) {
		row, err := owner.LoadSoleOwner(ctx, owner.PageDeps{Owners: d.OwnerRepo})
		if errors.Is(err, owner.ErrOwnerNotFound) {
			return "", nil
		}
		if err != nil {
			return "", fmt.Errorf("sole owner: %w", err)
		}
		return row.ID, nil
	}
}
