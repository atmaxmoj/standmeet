// webhook.go —— a webhook endpoint: where the owner's thin, signed events go
// (docs/design/event-bus-outbox-webhooks.md, *Webhook endpoints*). Instance configuration, like
// suppliers; the secret is sealed at rest and never part of this value.

package entity

import (
	"errors"
	"time"
)

// Names shared by the ops and the subscriber.
const (
	// WebhookDeliverKind —— the job that posts one event to one endpoint.
	WebhookDeliverKind = "webhook.deliver"
	// WebhookFanout —— the subscription that turns an event into deliveries.
	WebhookFanout = "webhook.fanout"
	// WebhookTestEvent —— send_test's event; it goes only to data.endpoint_id.
	WebhookTestEvent = "webhook.test"
	// NoteChanged —— the corpus_notes trigger's type: the one type with a scope rule, and the
	// one an embed's update hook hears.
	NoteChanged = "corpus.note.changed"
)

// ErrWebhookNotFound —— no endpoint with that id for this owner.
var ErrWebhookNotFound = errors.New("webhook endpoint not found")

// ErrWebhookBusy —— another delivery to this endpoint holds its lease.
var ErrWebhookBusy = errors.New("webhook endpoint is busy")

// ErrWebhookDisabled —— the endpoint is turned off; nothing is delivered to it.
var ErrWebhookDisabled = errors.New("webhook endpoint is disabled")

// ErrWebhookInput —— a value the endpoint cannot take (the caller's fault).
var ErrWebhookInput = errors.New("invalid webhook endpoint")

// WebhookEndpoint —— one receiver.
type WebhookEndpoint struct {
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
	FailingSince   *time.Time `json:"failing_since"`
	ID             string     `json:"id"`
	OwnerID        string     `json:"-"`
	URL            string     `json:"url"`
	Description    string     `json:"description"`
	EmbedID        string     `json:"embed_id"`
	DisabledReason string     `json:"disabled_reason"`
	EventTypes     []string   `json:"event_types"`
	Enabled        bool       `json:"enabled"`
}

// DeliverArgs —— a webhook.deliver job's args (the delivery log filters on endpoint_id).
type DeliverArgs struct {
	EndpointID string `json:"endpoint_id"`
	EventID    string `json:"event_id"`
}

// WebhookPatch —— an update; nil fields stay as they are.
type WebhookPatch struct {
	URL         *string
	Description *string
	Enabled     *bool
	EventTypes  []string // nil = unchanged
}
