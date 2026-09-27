// webhooks_embed.go —— an embed's "update hook": the one webhook endpoint attached to an embed,
// subscribed to corpus.note.changed, scoped by the embed's code
// (docs/design/event-bus-outbox-webhooks.md, *Webhook endpoints*).

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

// EmbedHooks —— the owner's embed-attached endpoints, by embed id.
func EmbedHooks(
	ctx context.Context, d *WebhooksDeps, ownerID string,
) (map[string]entity.WebhookEndpoint, error) {
	eps, err := d.Repo.ListWebhooks(ctx, ownerID)
	if err != nil {
		return nil, err //nolint:wrapcheck // the repo names its step
	}
	out := map[string]entity.WebhookEndpoint{}
	for i := range eps {
		if eps[i].EmbedID != "" {
			out[eps[i].EmbedID] = eps[i]
		}
	}
	return out, nil
}

// SetEmbedHook —— points embedID's update hook at url:
//   - no endpoint attached → creates one; the result carries its secret, this once;
//   - one attached, same url → unchanged, no secret;
//   - one attached, another url → its url is updated, no secret;
//   - url "" → the attached endpoint (if any) is deleted; the result is empty.
//
// The url is validated as webhooks.create validates it.
func SetEmbedHook(
	ctx context.Context, d *WebhooksDeps, ownerID, embedID, url string,
) (CreatedWebhook, error) {
	hooks, err := EmbedHooks(ctx, d, ownerID)
	if err != nil {
		return CreatedWebhook{}, err
	}
	cur, attached := hooks[embedID]
	switch {
	case attached:
		return changeEmbedHook(ctx, d, ownerID, &cur, url)
	case url == "":
		return CreatedWebhook{}, nil
	default:
		return createEmbedHook(ctx, d, ownerID, embedID, url)
	}
}

// changeEmbedHook —— the attached endpoint cur: deleted ("" url), kept (same url), or re-pointed.
func changeEmbedHook(
	ctx context.Context, d *WebhooksDeps, ownerID string, cur *entity.WebhookEndpoint, url string,
) (CreatedWebhook, error) {
	switch url {
	case "":
		return CreatedWebhook{}, DeleteWebhook(ctx, d, ownerID, cur.ID)
	case cur.URL:
		return CreatedWebhook{Endpoint: *cur}, nil
	}
	ep, err := UpdateWebhook(ctx, d, ownerID, cur.ID, &WebhookInput{URL: &url})
	return CreatedWebhook{Endpoint: ep}, err
}

// createEmbedHook —— a new endpoint attached to embedID, with its secret, shown this once.
func createEmbedHook(
	ctx context.Context, d *WebhooksDeps, ownerID, embedID, url string,
) (CreatedWebhook, error) {
	if err := validateWebhookURL(ctx, url); err != nil {
		return CreatedWebhook{}, err
	}
	secret, err := events.NewWebhookSecret()
	if err != nil {
		return CreatedWebhook{}, err //nolint:wrapcheck // names itself
	}
	ep := entity.WebhookEndpoint{
		URL: url, EventTypes: []string{entity.NoteChanged}, EmbedID: embedID,
	}
	created, err := d.Repo.CreateWebhook(ctx, ownerID, &ep, secret)
	if err != nil {
		return CreatedWebhook{}, err //nolint:wrapcheck // the repo names its step
	}
	return CreatedWebhook{Endpoint: created, Secret: secret}, nil
}
