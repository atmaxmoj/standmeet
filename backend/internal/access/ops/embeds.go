// embeds.go — owner ops for embed widget config (list / create / update / delete).
// An embed points at a code; the origin allowlist lives on the embed (embed plan 2026-09-01).

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
)

// EmbedsDeps — the data source for embed ops.
type EmbedsDeps struct {
	Embeds *repo.EmbedRepo
	Hooks  EmbedHooks
}

// Embeds — the owner's four operations on embeds.
func Embeds(d EmbedsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "embeds.list",
			Description: "List the owner's embed widgets, newest first, one page at a time " +
				"({items, next_cursor}): which code each exposes and on which origins.",
			InputSchema: paging.Schema(nil),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listEmbeds(d),
		},
		{
			ID: "embeds.create", Danger: fp.DangerCredential,
			Description: "Create an embed widget that exposes a code as a <standmeet-chat> " +
				"drop-in, optionally restricted to a set of origins.",
			InputSchema: embedCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createEmbed(d),
		},
		{
			ID: "embeds.update", Danger: fp.DangerAuthority,
			Description: "Update an embed's label, allowed origins and update hook URL. " +
				"Fields left out stay as they are.",
			InputSchema: embedUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateEmbed(d),
		},
		{
			ID: "embeds.delete", Danger: fp.DangerDestructive,
			Description: "Delete an embed (the code it exposed is left intact).",
			InputSchema: embedIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteEmbed(d),
		},
	}
}

var (
	embedCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"The access code this embed exposes."},
			"label":{"type":"string"},
			"allowed_origins":{"type":"array","items":{"type":"string"},
				"description":"Origins the widget may run on. Empty = any."},
			"sync_mode":{"type":"string","enum":["live","copy"],"description":` + syncModeDoc + `},
			"update_hook_url":{"type":"string","description":` + updateHookDoc + `}
		},
		"required":["code_id"]
	}`)
	embedUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"embed_id":{"type":"string"},
			"label":{"type":"string"},
			"allowed_origins":{"type":"array","items":{"type":"string"}},
			"sync_mode":{"type":"string","enum":["live","copy"],"description":` + syncModeDoc + `},
			"update_hook_url":{"type":"string","description":` + updateHookDoc + `}
		},
		"required":["embed_id"]
	}`)
	embedIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"embed_id":{"type":"string"}},
		"required":["embed_id"]
	}`)
)

// embedArgs — the shared input bag for this group. On update a field left out (nil) stays as
// it is.
type embedArgs struct {
	Label          *string   `json:"label"`
	AllowedOrigins *[]string `json:"allowed_origins"`
	SyncMode       *string   `json:"sync_mode"`
	UpdateHookURL  *string   `json:"update_hook_url"`
	ID             string    `json:"embed_id"`
	CodeID         string    `json:"code_id"`
}

// embedOut — outbound shape. key_id is the JWT's kid; the widget in the snippet signs with
// it + the private key. PrivateKey only has a value in the **create** receipt (omitempty) —
// it goes into the widget's JS (not the code); the server keeps only the public key, and
// list/update never carry it. Secret, the same way, only when the update hook's endpoint was
// just created.
type embedOut struct {
	UpdateHook     *EmbedHook `json:"update_hook,omitempty"`
	ID             string     `json:"id"`
	CodeID         string     `json:"code_id"`
	Code           string     `json:"code,omitempty"`
	Label          string     `json:"label"`
	KeyID          string     `json:"key_id"`
	SyncMode       string     `json:"sync_mode"`
	CreatedAt      string     `json:"created_at"`
	PrivateKey     string     `json:"private_key,omitempty"`
	Secret         string     `json:"secret,omitempty"`
	AllowedOrigins []string   `json:"allowed_origins"`
}

func toEmbedOut(e *entity.Embed) embedOut {
	origins := e.AllowedOrigins
	if origins == nil {
		origins = []string{}
	}
	return embedOut{
		ID: e.ID, CodeID: e.CodeID, Code: e.Code, Label: e.Label, KeyID: e.KeyID,
		SyncMode:       e.SyncMode,
		AllowedOrigins: origins,
		CreatedAt:      e.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func decodeEmbedArgs(raw json.RawMessage) (embedArgs, error) {
	var in embedArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, nil
}

func listEmbeds(d EmbedsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := paging.ParseArgs[struct{}](raw)
		if perr != nil {
			return nil, fp.BadInput("invalid arguments: " + perr.Error())
		}
		rows, err := d.Embeds.ListPage(ctx, ownerID, in.Req)
		if err != nil {
			return nil, embedErr(err)
		}
		hooks, err := d.Hooks.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list embed update hooks", err)
		}
		return json.Marshal(paging.Each(rows, func(e *entity.Embed) embedOut {
			o := toEmbedOut(e)
			withHook(&o, hooks)
			return o
		}))
	}
}

// createEmbed —— the embed, then its update hook if one is given.
func createEmbed(d EmbedsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeEmbedArgs(raw)
		if perr != nil {
			return nil, perr
		}
		c, err := newEmbedCreate(&in)
		if err != nil {
			return nil, err
		}
		created, err := d.Embeds.Create(ctx, ownerID, &c.spec)
		if err != nil {
			return nil, embedErr(err)
		}
		return createdOut(ctx, d, ownerID, &created, c.hookURL)
	}
}

// createdOut —— the create receipt, with the new embed's hook attached (none for ""). A hook
// that cannot be set takes the new embed back out, so a failed create leaves nothing behind.
func createdOut(
	ctx context.Context, d EmbedsDeps, ownerID string, created *entity.EmbedCreated, url string,
) (json.RawMessage, error) {
	out := toEmbedOut(&created.Embed)
	out.PrivateKey = created.PrivateKey
	if url == "" {
		return json.Marshal(out)
	}
	if err := setHook(ctx, d, ownerID, &out, url); err != nil {
		if derr := d.Embeds.Delete(ctx, ownerID, out.ID); derr != nil {
			// The hook's error stays the answer; the owner also learns the embed was left behind.
			err = errors.Join(err, fmt.Errorf("take the new embed back out: %w", derr))
		}
		return nil, fp.OpErr("set embed update hook", err)
	}
	return json.Marshal(out)
}

// updateEmbed —— applies the fields given; the rest stay as they are.
func updateEmbed(d EmbedsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeEmbedArgs(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"embed_id", in.ID}); err != nil {
			return nil, err
		}
		e, err := patchEmbed(ctx, d, ownerID, &in)
		if err != nil {
			return nil, embedErr(err)
		}
		return syncedEmbedOut(ctx, d, ownerID, &e, &in)
	}
}

// patchEmbed —— the embed with the given label / origins applied; untouched when neither is given.
func patchEmbed(
	ctx context.Context, d EmbedsDeps, ownerID string, in *embedArgs,
) (entity.Embed, error) {
	e, err := d.Embeds.Get(ctx, ownerID, in.ID)
	if err != nil || (in.Label == nil && in.AllowedOrigins == nil) {
		return e, err
	}
	return d.Embeds.Update(ctx, ownerID, in.ID,
		strOr(in.Label, e.Label), listOr(in.AllowedOrigins, e.AllowedOrigins))
}

// updatedEmbedOut —— e's view: its hook set to url when url is given, else its current hook.
func updatedEmbedOut(
	ctx context.Context, d EmbedsDeps, ownerID string, e *entity.Embed, url *string,
) (json.RawMessage, error) {
	out := toEmbedOut(e)
	if url != nil {
		if err := setHook(ctx, d, ownerID, &out, *url); err != nil {
			return nil, fp.OpErr("set embed update hook", err)
		}
		return json.Marshal(out)
	}
	hooks, err := d.Hooks.List(ctx, ownerID)
	if err != nil {
		return nil, fp.OpErr("list embed update hooks", err)
	}
	withHook(&out, hooks)
	return json.Marshal(out)
}

// strOr / listOr —— *p, or def when the field was left out.
func strOr(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}

func listOr(p *[]string, def []string) []string {
	if p == nil {
		return def
	}
	return *p
}

func deleteEmbed(d EmbedsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeEmbedArgs(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"embed_id", in.ID}); err != nil {
			return nil, err
		}
		if err := d.Embeds.Delete(ctx, ownerID, in.ID); err != nil {
			return nil, fp.OpErr("delete embed", err)
		}
		return json.Marshal(map[string]bool{"deleted": true})
	}
}

func embedErr(err error) error {
	if errors.Is(err, entity.ErrEmbedNotFound) {
		return fp.Coded(fp.NotFound("embed not found"), "embed_not_found")
	}
	if errors.Is(err, entity.ErrCodeAlreadyEmbedded) {
		return fp.Coded(
			fp.Conflict("code already exposed by an embed"), "code_already_embedded",
		)
	}
	return fp.OpErr("embed op", err)
}
