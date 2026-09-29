// embed_hooks.go — composition-root adapter: access's embed update-hook port, implemented with
// the owner domain's webhook use case. The endpoint is stored once, in webhook_endpoints; access
// only sees {endpoint_id, url} and the one-time secret. A bad URL comes back as the caller's
// fault, phrased by the owner domain.

package port

import (
	"context"
	"errors"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// EmbedHooks — access.EmbedHooks over the owner's webhook endpoints.
type EmbedHooks struct {
	Webhooks *owner.WebhooksDeps
}

// List — the attached hooks, by embed id.
func (h EmbedHooks) List(ctx context.Context, ownerID string) (map[string]access.EmbedHook, error) {
	eps, err := owner.EmbedHooks(ctx, h.Webhooks, ownerID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]access.EmbedHook, len(eps))
	for id := range eps {
		out[id] = access.EmbedHook{EndpointID: eps[id].ID, URL: eps[id].URL}
	}
	return out, nil
}

// Set — creates, re-points or ("" url) removes embedID's hook.
func (h EmbedHooks) Set(
	ctx context.Context, ownerID, embedID, url string,
) (access.EmbedHookSet, error) {
	got, err := owner.SetEmbedHook(ctx, h.Webhooks, ownerID, embedID, url)
	if errors.Is(err, owner.ErrWebhookInput) {
		return access.EmbedHookSet{}, fp.BadInput(err.Error())
	}
	if err != nil {
		return access.EmbedHookSet{}, err
	}
	if got.Endpoint.ID == "" {
		return access.EmbedHookSet{}, nil
	}
	hook := access.EmbedHook{EndpointID: got.Endpoint.ID, URL: got.Endpoint.URL}
	return access.EmbedHookSet{Hook: &hook, Secret: got.Secret}, nil
}
