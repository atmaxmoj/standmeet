// webhooks.go —— the webhooks.* group: where the owner's thin, signed events go
// (docs/design/event-bus-outbox-webhooks.md, *Webhook endpoints*). Declared once, projected to
// admin and owner MCP. Owner plane only.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

var (
	webhookIDSchema = json.RawMessage(`{"type":"object","properties":{
		"id":{"type":"string","description":"Webhook endpoint id."}},"required":["id"]}`)
	webhookWriteProps = `
		"url":{"type":"string","description":"Public http(s) URL the events are POSTed to."},
		"event_types":{"type":"array","items":{"type":"string"},
			"description":"Event types (or globs like corpus.note.*); see webhooks.event_types."},
		"description":{"type":"string","description":"A note for yourself."}`
	webhookCreateSchema = json.RawMessage(`{"type":"object","properties":{` + webhookWriteProps +
		`},"required":["url","event_types"]}`)
	webhookUpdateSchema = json.RawMessage(`{"type":"object","properties":{
		"id":{"type":"string","description":"Webhook endpoint id."},` + webhookWriteProps + `,
		"enabled":{"type":"boolean","description":"Off: no new deliveries. On: clears a failure."}},
		"required":["id"]}`)
)

// Webhooks —— the webhooks.* group. Not wired → none.
func Webhooks(d usecase.WebhooksDeps) []fp.Op {
	if d.Repo == nil || d.Bus == nil || d.Jobs == nil {
		return []fp.Op{}
	}
	return append(webhookReads(&d), webhookWrites(&d)...)
}

func webhookReads(d *usecase.WebhooksDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "webhooks.list", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: noArgs,
			Description: "List webhook endpoints: URL, event types, enabled, and why one was " +
				"disabled.",
			Invoke: listWebhooks(d),
		},
		{
			ID: "webhooks.event_types", Kind: fp.Read, Reach: fp.OwnerRead(), InputSchema: noArgs,
			Description: "The event types a webhook endpoint can subscribe to.",
			Invoke: func(context.Context, string, json.RawMessage) (json.RawMessage, error) {
				return json.Marshal(map[string][]eventTypeOut{"event_types": eventTypesOut(d)})
			},
		},
		{
			ID: "webhooks.deliveries", Kind: fp.Read, Reach: fp.OwnerRead(),
			InputSchema: webhookIDSchema,
			Description: "An endpoint's delivery log, newest first: state, attempt, event id " +
				"and the error of every failed attempt.",
			Invoke: withWebhookID(webhookDeliveries(d)),
		},
	}
}

func webhookWrites(d *usecase.WebhooksDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "webhooks.create", Kind: fp.Action, Reach: fp.OwnerAction(),
			InputSchema: webhookCreateSchema,
			Description: "Add a webhook endpoint. Returns its signing secret (whsec_…) once; " +
				"store it, it is not shown again.",
			Invoke: createWebhook(d),
		},
		{
			ID: "webhooks.update", Kind: fp.Action, Reach: fp.OwnerAction(),
			InputSchema: webhookUpdateSchema,
			Description: "Change an endpoint's URL, event types or description, or turn it " +
				"off and on.",
			Invoke: updateWebhook(d),
		},
		{
			ID: "webhooks.delete", Kind: fp.Action, Reach: fp.OwnerAction(),
			InputSchema: webhookIDSchema,
			Description: "Remove a webhook endpoint. Its queued deliveries are dropped.",
			Invoke: withWebhookID(func(ctx context.Context, owner, id string) (flagOut, error) {
				return flagOut{"deleted": true}, usecase.DeleteWebhook(ctx, d, owner, id)
			}),
		},
		{
			ID: "webhooks.rotate_secret", Kind: fp.Action, Reach: fp.OwnerAction(),
			InputSchema: webhookIDSchema,
			Description: "Replace an endpoint's signing secret. Returns the new secret once.",
			Invoke: withWebhookID(func(ctx context.Context, owner, id string) (textOut, error) {
				s, err := usecase.RotateWebhookSecret(ctx, d, owner, id)
				return textOut{"secret": s}, err
			}),
		},
		{
			ID: "webhooks.send_test", Kind: fp.Action, Reach: fp.OwnerAction(),
			InputSchema: webhookIDSchema,
			Description: "Send a webhook.test event to this endpoint only. The delivery log " +
				"shows whether it arrived.",
			Invoke: withWebhookID(func(ctx context.Context, owner, id string) (textOut, error) {
				ev, err := usecase.SendWebhookTest(ctx, d, owner, id)
				return textOut{"event_id": ev}, err
			}),
		},
		{
			ID: "webhooks.redeliver", Kind: fp.Action, Reach: fp.OwnerAction(),
			InputSchema: webhookIDSchema,
			Description: "Deliver again every discarded delivery of this endpoint (after the " +
				"receiver is fixed).",
			Invoke: withWebhookID(func(ctx context.Context, owner, id string) (countOut, error) {
				n, err := usecase.RedeliverWebhook(ctx, d, owner, id)
				return countOut{"redelivered": n}, err
			}),
		},
	}
}

// The shapes a per-endpoint op answers with.
type (
	deliveriesOut = map[string][]usecase.Delivery
	flagOut       = map[string]bool
	textOut       = map[string]string
	countOut      = map[string]int
)

// perEndpoint —— one op on one endpoint of the owner's.
type perEndpoint[T webhookOut] func(ctx context.Context, owner, id string) (T, error)

func webhookDeliveries(d *usecase.WebhooksDeps) perEndpoint[deliveriesOut] {
	return func(ctx context.Context, owner, id string) (deliveriesOut, error) {
		list, err := usecase.WebhookDeliveries(ctx, d, owner, id)
		return deliveriesOut{"deliveries": list}, err
	}
}

// webhookOut —— what withWebhookID may encode.
type webhookOut interface {
	deliveriesOut | flagOut | textOut | countOut
}

func listWebhooks(d *usecase.WebhooksDeps) fp.Invoke {
	return func(ctx context.Context, owner string, _ json.RawMessage) (json.RawMessage, error) {
		list, err := usecase.ListWebhooks(ctx, d, owner)
		if err != nil {
			return nil, webhookErr(err)
		}
		return json.Marshal(map[string][]entity.WebhookEndpoint{"endpoints": list})
	}
}

type eventTypeOut struct {
	Type        string `json:"type"`
	Description string `json:"description"`
	Subject     string `json:"subject"`
}

func eventTypesOut(d *usecase.WebhooksDeps) []eventTypeOut {
	types := usecase.WebhookEventTypes(d)
	out := make([]eventTypeOut, 0, len(types))
	for _, t := range types {
		out = append(out,
			eventTypeOut{Type: t.Type, Description: t.Description, Subject: t.Subject})
	}
	return out
}

type webhookWriteArgs struct {
	URL         *string  `json:"url"`
	Description *string  `json:"description"`
	Enabled     *bool    `json:"enabled"`
	ID          string   `json:"id"`
	EventTypes  []string `json:"event_types"`
}

func (a *webhookWriteArgs) input() *usecase.WebhookInput {
	return &usecase.WebhookInput{
		URL: a.URL, Description: a.Description, Enabled: a.Enabled, EventTypes: a.EventTypes,
	}
}

func createWebhook(d *usecase.WebhooksDeps) fp.Invoke {
	return func(ctx context.Context, owner string, raw json.RawMessage) (json.RawMessage, error) {
		var a webhookWriteArgs
		if err := json.Unmarshal(raw, &a); err != nil {
			return nil, fp.BadInput("invalid arguments")
		}
		out, err := usecase.CreateWebhook(ctx, d, owner, a.input())
		if err != nil {
			return nil, webhookErr(err)
		}
		return json.Marshal(out)
	}
}

func updateWebhook(d *usecase.WebhooksDeps) fp.Invoke {
	return func(ctx context.Context, owner string, raw json.RawMessage) (json.RawMessage, error) {
		var a webhookWriteArgs
		if err := json.Unmarshal(raw, &a); err != nil || a.ID == "" {
			return nil, fp.BadInput("id is required")
		}
		out, err := usecase.UpdateWebhook(ctx, d, owner, a.ID, a.input())
		if err != nil {
			return nil, webhookErr(err)
		}
		return json.Marshal(map[string]entity.WebhookEndpoint{"endpoint": out})
	}
}

// withWebhookID —— decodes {id}, runs fn, and encodes its result.
func withWebhookID[T webhookOut](fn perEndpoint[T]) fp.Invoke {
	return func(ctx context.Context, owner string, raw json.RawMessage) (json.RawMessage, error) {
		var a struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(raw, &a); err != nil || a.ID == "" {
			return nil, fp.BadInput("id is required")
		}
		out, err := fn(ctx, owner, a.ID)
		if err != nil {
			return nil, webhookErr(err)
		}
		return json.Marshal(out)
	}
}

func webhookErr(err error) error {
	switch {
	case errors.Is(err, entity.ErrWebhookInput):
		return fp.BadInput(err.Error())
	case errors.Is(err, entity.ErrWebhookNotFound):
		return fp.NotFound("no such webhook endpoint")
	default:
		return fp.OpErr("webhooks", err)
	}
}
