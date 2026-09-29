// Package subscriber —— what the owner domain does in response to events: webhook fan-out and
// delivery (docs/design/event-bus-outbox-webhooks.md, *Relay and delivery*). Declared as data,
// collected generically by the composition root, run as durable jobs.
//
//   - webhook.fanout (a subscription on every webhook-exposed type): loads the owner's enabled
//     endpoints that subscribe to the type, applies scope, and enqueues one webhook.deliver job
//     per endpoint, all in one transaction. An endpoint in its failure streak gets its job after
//     the cooldown, so a dead receiver is not hit once per new event.
//   - webhook.deliver {endpoint_id, event_id}: takes the endpoint's lease (at most one delivery in
//     flight per endpoint, across processes), reads what it needs with short reads, releases the
//     connection, POSTs, then settles: success ends the failure streak; failure starts it and,
//     after 5 days, turns the endpoint off. No transaction is held across the POST.
//
// This layer may use usecase and repo; nothing below may import it (check-domain-layering).
package subscriber

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// Delivery limits.
const (
	// Cooldown —— how far out a new delivery to a failing endpoint is scheduled.
	Cooldown = 5 * time.Minute
	// DisableAfter —— a failure streak this old turns the endpoint off.
	DisableAfter = 5 * 24 * time.Hour
	// busySnooze —— another delivery to the same endpoint is in flight: try again after this.
	busySnooze = 2 * time.Second
	// leaseFor —— outlives the job timeout, so a crashed worker's lease expires on its own.
	leaseFor       = events.WebhookTimeout + 5*time.Second
	settleTimeout  = 5 * time.Second
	fanoutAttempts = 10
	fanoutTimeout  = 30 * time.Second
	disabledReason = "disabled after 5 days of failed deliveries"
)

// SecretOpener —— the endpoint's signing secret in the clear. Supplied by the composition root,
// the only place a sealed secret is opened (cmd/server/unseal.go).
type SecretOpener func(ctx context.Context, endpointID string) (string, error)

// EmbedAdmits —— whether a corpus entry is inside an embed's scope (its code's scope, judged by
// access.AllowsCorpusEntry). Supplied by the composition root, which reads the access domain;
// it is asked on every event, because a code can be revoked or re-scoped at any time.
type EmbedAdmits func(
	ctx context.Context, ownerID, embedID, uri string, published bool,
) (bool, error)

// Deps —— what fan-out and delivery need. Jobs and Event are read at run time: the job runtime
// and the bus are built after the declarations that point at them.
type Deps struct {
	Repo    *repo.Repo
	Pool    *pgstore.Pool
	Secrets SecretOpener
	Embeds  EmbedAdmits
	Jobs    func() jobs.Jobs
	Event   func(ctx context.Context, id string) (events.Event, error)
	client  *http.Client
}

// NewDeps —— d with the SSRF-guarded delivery client.
func NewDeps(d *Deps) *Deps {
	d.client = events.NewWebhookClient()
	return d
}

// EventTypes —— the event types this domain owns.
func EventTypes() []events.Type {
	return []events.Type{{
		Type:        entity.WebhookTestEvent,
		Description: "A test event sent from the admin or webhooks.send_test (data.endpoint_id).",
		Subject:     "webhook://<endpoint id>",
		Exposure:    events.Webhook,
	}}
}

// Subscriptions —— the fan-out, on every webhook-exposed type among declared.
func Subscriptions(d *Deps, declared []events.Type) []events.Subscription {
	types := []string{}
	for _, t := range declared {
		if t.Exposure == events.Webhook {
			types = append(types, t.Type)
		}
	}
	if len(types) == 0 {
		return []events.Subscription{}
	}
	return []events.Subscription{{
		Name: entity.WebhookFanout, Types: types, Queue: jobs.QueueWebhook,
		MaxAttempts: fanoutAttempts, Timeout: fanoutTimeout,
		Handle: func(ctx context.Context, ev events.Event) error { return fanOut(ctx, d, &ev) },
	}}
}

// Kinds —— webhook.deliver.
func Kinds(d *Deps) []jobs.Kind {
	return []jobs.Kind{{
		Name: entity.WebhookDeliverKind, Queue: jobs.QueueWebhook,
		MaxAttempts: events.WebhookMaxAttempts, Timeout: events.WebhookTimeout,
		Backoff: events.WebhookBackoff,
		Handle: func(ctx context.Context, raw json.RawMessage) error {
			return deliver(ctx, d, raw)
		},
	}}
}

// fanOut —— one webhook.deliver job per matching endpoint, in one transaction.
func fanOut(ctx context.Context, d *Deps, ev *events.Event) error {
	if ev.OwnerID == "" {
		return nil
	}
	eps, err := d.Repo.EnabledWebhooks(ctx, ev.OwnerID)
	if err != nil {
		return err
	}
	targets, err := Targets(ctx, eps, ev, d.Embeds)
	if err != nil {
		return err
	}
	if len(targets) == 0 {
		return nil
	}
	return pgstore.InTx(ctx, d.Pool, func(tx pgstore.Tx) error {
		return enqueueDeliveries(ctx, d.Jobs().With(tx), targets, ev.ID)
	})
}

// enqueueDeliveries —— one job per target; a target in its failure streak waits out the cooldown.
// Unique per (endpoint, event): a fan-out that runs twice queues each delivery once.
func enqueueDeliveries(
	ctx context.Context, j jobs.Jobs, targets []entity.WebhookEndpoint, eventID string,
) error {
	for i := range targets {
		opts := jobs.EnqueueOpts{UniqueByArgs: true}
		if targets[i].FailingSince != nil {
			opts.RunAt = time.Now().Add(Cooldown)
		}
		args := entity.DeliverArgs{EndpointID: targets[i].ID, EventID: eventID}
		if _, err := j.Enqueue(ctx, entity.WebhookDeliverKind, args, opts); err != nil {
			return fmt.Errorf("enqueue delivery to %s: %w", targets[i].ID, err)
		}
	}
	return nil
}

// Targets —— the endpoints ev goes to. webhook.test goes only to its own endpoint, whatever that
// endpoint subscribes to; everything else goes to the endpoints that subscribe to its type and
// whose scope admits it.
func Targets(
	ctx context.Context, eps []entity.WebhookEndpoint, ev *events.Event, embeds EmbedAdmits,
) ([]entity.WebhookEndpoint, error) {
	if ev.Type == entity.WebhookTestEvent {
		return testTarget(eps, ev), nil
	}
	out := make([]entity.WebhookEndpoint, 0, len(eps))
	for i := range eps {
		in, err := targeted(ctx, &eps[i], ev, embeds)
		if err != nil {
			return nil, err
		}
		if in {
			out = append(out, eps[i])
		}
	}
	return out, nil
}

// targeted —— ep subscribes to ev's type and its scope admits ev.
func targeted(
	ctx context.Context, ep *entity.WebhookEndpoint, ev *events.Event, embeds EmbedAdmits,
) (bool, error) {
	if !subscribes(ep.EventTypes, ev.Type) {
		return false, nil
	}
	return InScope(ctx, ep, ev, embeds)
}

// testTarget —— the one endpoint a webhook.test event names (data.endpoint_id).
func testTarget(eps []entity.WebhookEndpoint, ev *events.Event) []entity.WebhookEndpoint {
	var a entity.DeliverArgs
	_ = json.Unmarshal(ev.Data, &a) //nolint:errcheck // an unreadable test event goes nowhere
	for i := range eps {
		if eps[i].ID == a.EndpointID {
			return eps[i : i+1]
		}
	}
	return []entity.WebhookEndpoint{}
}

func subscribes(globs []string, typ string) bool {
	for _, g := range globs {
		if events.Match(g, typ) {
			return true
		}
	}
	return false
}

// InScope —— whether ev may go to ep. Other types than a note change always.
//   - An endpoint attached to an embed gets the embed's code scope (embeds): role globs minus
//     the code's denials. Published counts only where the code's role reads the published slice.
//     No embeds port, a deleted embed or a revoked code → nothing.
//   - A standalone endpoint gets the published slice: a note change only when the note is
//     published or was published a moment ago (so an unpublish is heard).
//
// raw:// never leaves the instance.
func InScope(
	ctx context.Context, ep *entity.WebhookEndpoint, ev *events.Event, embeds EmbedAdmits,
) (bool, error) {
	if ev.Type != entity.NoteChanged {
		return true, nil
	}
	if strings.HasPrefix(ev.Subject, "raw://") {
		return false, nil
	}
	if ep.EmbedID == "" {
		return published(ev), nil
	}
	if embeds == nil {
		return false, nil
	}
	return embeds(ctx, ev.OwnerID, ep.EmbedID, ev.Subject, published(ev))
}

// published —— the note is published, or was a moment ago (so an unpublish is heard).
func published(ev *events.Event) bool {
	var d struct {
		Published    bool `json:"published"`
		WasPublished bool `json:"was_published"`
	}
	_ = json.Unmarshal(ev.Data, &d) //nolint:errcheck // unreadable → unpublished
	return d.Published || d.WasPublished
}

// deliver —— one attempt of webhook.deliver.
func deliver(ctx context.Context, d *Deps, raw json.RawMessage) error {
	a, err := deliverArgs(raw)
	if err != nil {
		return err
	}
	ep, err := lease(ctx, d, a.EndpointID)
	if err != nil {
		return err
	}
	result := post(ctx, d, &ep, a.EventID)
	return errors.Join(result, settle(ctx, d, ep.ID, result))
}

func deliverArgs(raw json.RawMessage) (entity.DeliverArgs, error) {
	var a entity.DeliverArgs
	if err := json.Unmarshal(raw, &a); err != nil || a.EndpointID == "" || a.EventID == "" {
		return a, jobs.Discard(fmt.Errorf("webhook.deliver: bad args %s", raw))
	}
	return a, nil
}

// lease —— the endpoint with its lease taken, or the failure class of why not: gone or turned
// off → discard; busy → snooze (no attempt spent).
func lease(ctx context.Context, d *Deps, id string) (entity.WebhookEndpoint, error) {
	ep, err := d.Repo.LeaseWebhook(ctx, id, leaseFor)
	switch {
	case errors.Is(err, entity.ErrWebhookBusy):
		return ep, jobs.Snooze(busySnooze)
	case errors.Is(err, entity.ErrWebhookNotFound), errors.Is(err, entity.ErrWebhookDisabled):
		return ep, jobs.Discard(err)
	default:
		return ep, err
	}
}

// settle —— releases the lease and records the outcome, even when the attempt's ctx has ended.
func settle(ctx context.Context, d *Deps, id string, result error) error {
	sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), settleTimeout)
	defer cancel()
	if result == nil {
		return d.Repo.WebhookSucceeded(sctx, id)
	}
	return d.Repo.WebhookFailed(sctx, id, DisableAfter, disabledReason)
}

// post —— the event and the secret (short reads, no transaction), then the HTTP call.
func post(ctx context.Context, d *Deps, ep *entity.WebhookEndpoint, eventID string) error {
	ev, err := d.Event(ctx, eventID)
	if errors.Is(err, events.ErrNotFound) {
		return jobs.Discard(err) // pruned; nothing left to deliver
	}
	if err != nil {
		return err
	}
	secret, err := d.Secrets(ctx, ep.ID)
	if err != nil {
		return err
	}
	return events.DeliverWebhook(ctx, d.client, ep.URL, secret, &ev)
}
