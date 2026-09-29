// webhooks.go —— the owner's webhook endpoints: CRUD, the one-time secret, send-test, and the
// delivery log (docs/design/event-bus-outbox-webhooks.md, *Webhook endpoints*).
//
// Deliveries themselves are jobs (internal/owner/subscriber); the log is a filtered view of those
// job rows, so nothing here keeps a second record of what was sent.

package usecase

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// maxDeliveries —— how many of an endpoint's deliveries the log (and a re-deliver) reads.
const maxDeliveries = 500

// WebhooksDeps —— the endpoint store, the bus (declared types; webhook.test), the job rows.
type WebhooksDeps struct {
	Repo *repo.Repo
	Bus  *events.Bus
	Jobs jobs.Inspector
}

// WebhookInput —— create / update input. Nil fields are left unchanged on update.
type WebhookInput struct {
	URL         *string
	Description *string
	Enabled     *bool
	EventTypes  []string
}

// CreatedWebhook —— the endpoint, plus its secret, shown this once.
type CreatedWebhook struct {
	Secret   string                 `json:"secret"`
	Endpoint entity.WebhookEndpoint `json:"endpoint"`
}

// Delivery —— one row of an endpoint's delivery log (one webhook.deliver job).
type Delivery struct {
	CreatedAt   time.Time           `json:"created_at"`
	FinalizedAt *time.Time          `json:"finalized_at"`
	State       jobs.State          `json:"state"`
	EventID     string              `json:"event_id"`
	Errors      []jobs.AttemptError `json:"errors"`
	JobID       jobs.JobID          `json:"job_id"`
	Attempt     int                 `json:"attempt"`
}

func inputErr(msg string) error { return fmt.Errorf("%w: %s", entity.ErrWebhookInput, msg) }

// WebhookEventTypes —— the types that may leave the instance.
func WebhookEventTypes(d *WebhooksDeps) []events.Type { return d.Bus.WebhookTypes() }

// ListWebhooks —— the owner's endpoints.
func ListWebhooks(
	ctx context.Context, d *WebhooksDeps, ownerID string,
) ([]entity.WebhookEndpoint, error) {
	return d.Repo.ListWebhooks(ctx, ownerID)
}

// CreateWebhook —— validates, then stores the endpoint with a fresh secret.
func CreateWebhook(
	ctx context.Context, d *WebhooksDeps, ownerID string, in *WebhookInput,
) (CreatedWebhook, error) {
	if err := validateCreate(ctx, d, in); err != nil {
		return CreatedWebhook{}, err
	}
	secret, err := events.NewWebhookSecret()
	if err != nil {
		return CreatedWebhook{}, err
	}
	ep := entity.WebhookEndpoint{URL: *in.URL, EventTypes: in.EventTypes}
	if in.Description != nil {
		ep.Description = *in.Description
	}
	created, err := d.Repo.CreateWebhook(ctx, ownerID, &ep, secret)
	if err != nil {
		return CreatedWebhook{}, err
	}
	return CreatedWebhook{Endpoint: created, Secret: secret}, nil
}

func validateCreate(ctx context.Context, d *WebhooksDeps, in *WebhookInput) error {
	if in.URL == nil {
		return inputErr("url is required")
	}
	if err := validateWebhookURL(ctx, *in.URL); err != nil {
		return err
	}
	return validateEventTypes(d, in.EventTypes)
}

// UpdateWebhook —— validates what changes, then applies it.
func UpdateWebhook(
	ctx context.Context, d *WebhooksDeps, ownerID, id string, in *WebhookInput,
) (entity.WebhookEndpoint, error) {
	if in.URL != nil {
		if err := validateWebhookURL(ctx, *in.URL); err != nil {
			return entity.WebhookEndpoint{}, err
		}
	}
	if in.EventTypes != nil {
		if err := validateEventTypes(d, in.EventTypes); err != nil {
			return entity.WebhookEndpoint{}, err
		}
	}
	p := entity.WebhookPatch{
		URL: in.URL, Description: in.Description, Enabled: in.Enabled, EventTypes: in.EventTypes,
	}
	return d.Repo.UpdateWebhook(ctx, ownerID, id, &p)
}

// DeleteWebhook —— removes the endpoint.
func DeleteWebhook(ctx context.Context, d *WebhooksDeps, ownerID, id string) error {
	return d.Repo.DeleteWebhook(ctx, ownerID, id)
}

// RotateWebhookSecret —— a new secret, shown this once. Deliveries sign with it from now on.
func RotateWebhookSecret(ctx context.Context, d *WebhooksDeps, ownerID, id string) (string, error) {
	secret, err := events.NewWebhookSecret()
	if err != nil {
		return "", err
	}
	if rerr := d.Repo.RotateWebhookSecret(ctx, ownerID, id, secret); rerr != nil {
		return "", rerr
	}
	return secret, nil
}

// SendWebhookTest —— records a webhook.test event for this endpoint only. Returns the event id.
func SendWebhookTest(ctx context.Context, d *WebhooksDeps, ownerID, id string) (string, error) {
	if _, err := d.Repo.GetWebhook(ctx, ownerID, id); err != nil {
		return "", err
	}
	data := struct {
		EndpointID string `json:"endpoint_id"`
	}{id}
	rec, subject := d.Bus.Recorder(), "webhook://"+id
	if err := rec.Record(ctx, ownerID, entity.WebhookTestEvent, subject, data); err != nil {
		return "", err
	}
	return d.Bus.LatestFor(ctx, entity.WebhookTestEvent, "endpoint_id", id)
}

// deliveredEventID —— the event a delivery job carries. Only the fan-out writes these args, so
// unreadable args name no event.
func deliveredEventID(args json.RawMessage) string {
	var a entity.DeliverArgs
	if err := json.Unmarshal(args, &a); err != nil {
		return ""
	}
	return a.EventID
}

// WebhookDeliveries —— the endpoint's deliveries, newest first.
func WebhookDeliveries(
	ctx context.Context, d *WebhooksDeps, ownerID, id string,
) ([]Delivery, error) {
	list, err := deliveryJobs(ctx, d, ownerID, id, "")
	if err != nil {
		return nil, err
	}
	out := make([]Delivery, 0, len(list))
	for i := range list {
		out = append(out, Delivery{
			JobID: list[i].ID, State: list[i].State, Attempt: list[i].Attempt,
			EventID: deliveredEventID(list[i].Args),
			Errors:  list[i].Errors, CreatedAt: list[i].CreatedAt, FinalizedAt: list[i].FinalizedAt,
		})
	}
	return out, nil
}

// RedeliverWebhook —— runs every discarded delivery of the endpoint again. Returns how many.
func RedeliverWebhook(ctx context.Context, d *WebhooksDeps, ownerID, id string) (int, error) {
	list, err := deliveryJobs(ctx, d, ownerID, id, jobs.StateDiscarded)
	if err != nil {
		return 0, err
	}
	for i := range list {
		if rerr := d.Jobs.Retry(ctx, list[i].ID); rerr != nil {
			return i, rerr
		}
	}
	return len(list), nil
}

// deliveryJobs —— the endpoint's webhook.deliver jobs in state st ("" = any), after checking the
// endpoint is the owner's.
func deliveryJobs(
	ctx context.Context, d *WebhooksDeps, ownerID, id string, st jobs.State,
) ([]jobs.Job, error) {
	if _, err := d.Repo.GetWebhook(ctx, ownerID, id); err != nil {
		return nil, err
	}
	args, err := json.Marshal(map[string]string{"endpoint_id": id})
	if err != nil {
		return nil, fmt.Errorf("delivery filter: %w", err)
	}
	f := jobs.Filter{Kind: entity.WebhookDeliverKind, State: st, Args: args, Limit: maxDeliveries}
	return d.Jobs.List(ctx, f)
}

// validateWebhookURL —— http(s), and a public host: the delivery client's SSRF guard would refuse
// anything else at dial time, so it is refused here with a readable reason instead.
func validateWebhookURL(ctx context.Context, raw string) error {
	if !isHTTPURL(raw) {
		return inputErr("url must be an http:// or https:// address")
	}
	if httpx.ValidatePublicURL(ctx, raw) != nil {
		return inputErr("url must reach a public host; private, loopback and internal " +
			"addresses are not allowed")
	}
	return nil
}

func isHTTPURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != ""
}

// validateEventTypes —— every entry is a type (or glob) that may leave the instance.
func validateEventTypes(d *WebhooksDeps, types []string) error {
	if len(types) == 0 {
		return inputErr("choose at least one event type")
	}
	exposed := d.Bus.WebhookTypes()
	for _, g := range types {
		if !matchesAnyType(g, exposed) {
			return inputErr(fmt.Sprintf("%q is not an event type a webhook can receive", g))
		}
	}
	return nil
}

func matchesAnyType(glob string, types []events.Type) bool {
	for _, t := range types {
		if events.Match(glob, t.Type) {
			return true
		}
	}
	return false
}
