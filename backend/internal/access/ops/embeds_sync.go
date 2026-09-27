// embeds_sync.go —— an embed's sync mode and the hook that must agree with it
// (docs/design/event-bus-outbox-webhooks.md, *Embed sync mode*): a copy embed has an update hook,
// a live embed has none.

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// embedCreate —— the embed a create asks for, and its hook URL.
type embedCreate struct {
	hookURL string
	spec    entity.NewEmbed
}

// newEmbedCreate —— what the create asks for; refused when the mode and the hook disagree.
func newEmbedCreate(in *embedArgs) (embedCreate, error) {
	if err := fp.RequireArgs([2]string{"code_id", in.CodeID}); err != nil {
		return embedCreate{}, err
	}
	c := embedCreate{
		hookURL: strOr(in.UpdateHookURL, ""),
		spec: entity.NewEmbed{
			CodeID: in.CodeID, Label: strOr(in.Label, ""),
			SyncMode:       strOr(in.SyncMode, entity.SyncLive),
			AllowedOrigins: listOr(in.AllowedOrigins, []string{}),
		},
	}
	return c, checkSync(c.spec.SyncMode, c.hookURL)
}

// syncedEmbedOut —— e's view after the mode and hook in `in`: a mode change goes through
// switchedEmbedOut; otherwise a hook URL given must agree with the embed's current mode.
func syncedEmbedOut(
	ctx context.Context, d EmbedsDeps, ownerID string, e *entity.Embed, in *embedArgs,
) (json.RawMessage, error) {
	if in.SyncMode != nil && *in.SyncMode != e.SyncMode {
		return switchedEmbedOut(ctx, d, ownerID, e, in)
	}
	if in.UpdateHookURL == nil {
		return updatedEmbedOut(ctx, d, ownerID, e, nil)
	}
	if cerr := checkSync(e.SyncMode, *in.UpdateHookURL); cerr != nil {
		return nil, cerr
	}
	return updatedEmbedOut(ctx, d, ownerID, e, in.UpdateHookURL)
}

// syncHookMismatch —— what a mode says when its hook is wrong: a live embed has none, a copy
// embed has one.
var syncHookMismatch = map[string]string{
	entity.SyncLive: "a live embed has no update hook",
	entity.SyncCopy: "a copy embed needs an update hook URL",
}

// checkSync —— the mode is one of the two, and the hook URL ("" = none) agrees with it.
func checkSync(mode, hookURL string) error {
	if !entity.ValidSyncMode(mode) {
		return fp.BadInput("sync_mode must be live or copy")
	}
	if (mode == entity.SyncCopy) != (hookURL != "") {
		return fp.BadInput(syncHookMismatch[mode])
	}
	return nil
}

// switchedEmbedOut —— e moved to in.SyncMode. A live embed had no hook, so copy needs a URL;
// live removes the hook (the URL must be empty). The hook is set before the mode, so a failed
// hook leaves the embed in its old mode.
func switchedEmbedOut(
	ctx context.Context, d EmbedsDeps, ownerID string, e *entity.Embed, in *embedArgs,
) (json.RawMessage, error) {
	mode, url := *in.SyncMode, strOr(in.UpdateHookURL, "")
	if err := checkSync(mode, url); err != nil {
		return nil, err
	}
	out := toEmbedOut(e)
	if err := setHook(ctx, d, ownerID, &out, url); err != nil {
		return nil, fp.OpErr("set embed update hook", err)
	}
	updated, err := d.Embeds.SetSyncMode(ctx, ownerID, e.ID, mode)
	if err != nil {
		return nil, embedErr(err)
	}
	out.SyncMode = updated.SyncMode
	return json.Marshal(out)
}
