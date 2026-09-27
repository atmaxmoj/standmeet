// embeds_hook.go —— an embed's update hook (docs/design/event-bus-outbox-webhooks.md, *Webhook
// endpoints*): a webhook endpoint attached to the embed. The endpoint lives in the owner domain;
// this domain only asks for it through EmbedHooks, so it never keeps a second copy.

package ops

import "context"

// updateHookDoc —— the update_hook_url field's description (a JSON string).
const updateHookDoc = `"A public http(s) URL that receives a signed corpus.note.changed event ` +
	`whenever a note inside this embed's code scope changes. The signing secret is returned ` +
	`once, when the hook is first attached. An empty string removes the hook."`

// syncModeDoc —— the sync_mode field's description (a JSON string).
const syncModeDoc = `"How the site behind this embed keeps up with the corpus. ` +
	`copy: the site keeps a copy and the update hook tells it what changed ` +
	`(needs update_hook_url). live: the site reads the instance on every request; ` +
	`no hook (switching to live removes it). Default live."`

// EmbedHook —— the hook as the embed view shows it.
type EmbedHook struct {
	EndpointID string `json:"endpoint_id"`
	URL        string `json:"url"`
}

// EmbedHookSet —— the hook after a set (nil: removed), and its secret when the endpoint was
// just created ("" otherwise).
type EmbedHookSet struct {
	Hook   *EmbedHook
	Secret string
}

// EmbedHooks —— the owner domain's embed-attached endpoints. The composition root implements it
// with the owner's webhook use case; its errors come back already classified (bad input → the
// caller's fault).
type EmbedHooks interface {
	// List —— the attached hooks, by embed id.
	List(ctx context.Context, ownerID string) (map[string]EmbedHook, error)
	// Set —— creates, re-points or ("" url) removes embedID's hook.
	Set(ctx context.Context, ownerID, embedID, url string) (EmbedHookSet, error)
}

// withHook —— sets out's hook from hooks, if it has one.
func withHook(out *embedOut, hooks map[string]EmbedHook) {
	if h, ok := hooks[out.ID]; ok {
		out.UpdateHook = &h
	}
}

// setHook —— applies url to out's hook and carries the result on out.
func setHook(ctx context.Context, d EmbedsDeps, ownerID string, out *embedOut, url string) error {
	set, err := d.Hooks.Set(ctx, ownerID, out.ID, url)
	if err != nil {
		return err
	}
	out.UpdateHook, out.Secret = set.Hook, set.Secret
	return nil
}
