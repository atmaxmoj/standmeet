// embeds.go — owner capabilities for embed widget config (list / create / update / delete).
// An embed points at a code; the origin allowlist lives on the embed (embed plan 2026-09-01).

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// EmbedsDeps — the data source for embed capabilities.
type EmbedsDeps struct {
	Embeds *repo.EmbedRepo
}

// Embeds — the owner's four operations on embeds.
func Embeds(d EmbedsDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "embeds.list",
			Description: "List the owner's embed widgets: which code each exposes " +
				"and on which origins.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listEmbeds(d),
		},
		{
			ID: "embeds.create",
			Description: "Create an embed widget that exposes a code as a <standmeet-chat> " +
				"drop-in, optionally restricted to a set of origins.",
			InputSchema: embedCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createEmbed(d),
		},
		{
			ID:          "embeds.update",
			Description: "Update an embed's label and allowed origins.",
			InputSchema: embedUpdateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateEmbed(d),
		},
		{
			ID:          "embeds.delete",
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
				"description":"Origins the widget may run on. Empty = any."}
		},
		"required":["code_id"]
	}`)
	embedUpdateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"embed_id":{"type":"string"},
			"label":{"type":"string"},
			"allowed_origins":{"type":"array","items":{"type":"string"}}
		},
		"required":["embed_id"]
	}`)
	embedIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"embed_id":{"type":"string"}},
		"required":["embed_id"]
	}`)
)

// embedArgs — the shared input bag for this group.
type embedArgs struct {
	ID             string   `json:"embed_id"`
	CodeID         string   `json:"code_id"`
	Label          string   `json:"label"`
	AllowedOrigins []string `json:"allowed_origins"`
}

// embedOut — outbound shape. key_id is the JWT's kid; the widget in the snippet signs with
// it + the private key. PrivateKey only has a value in the **create** receipt (omitempty) —
// it goes into the widget's JS (not the code); the server keeps only the public key, and
// list/update never carry it.
type embedOut struct {
	ID             string   `json:"id"`
	CodeID         string   `json:"code_id"`
	Label          string   `json:"label"`
	KeyID          string   `json:"key_id"`
	CreatedAt      string   `json:"created_at"`
	PrivateKey     string   `json:"private_key,omitempty"`
	AllowedOrigins []string `json:"allowed_origins"`
}

func toEmbedOut(e *entity.Embed) embedOut {
	origins := e.AllowedOrigins
	if origins == nil {
		origins = []string{}
	}
	return embedOut{
		ID: e.ID, CodeID: e.CodeID, Label: e.Label, KeyID: e.KeyID,
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
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := d.Embeds.ListByOwner(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list embeds", err)
		}
		out := make([]embedOut, 0, len(rows))
		for i := range rows {
			out = append(out, toEmbedOut(&rows[i]))
		}
		return json.Marshal(out)
	}
}

func createEmbed(d EmbedsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeEmbedArgs(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"code_id", in.CodeID}); err != nil {
			return nil, err
		}
		created, err := d.Embeds.Create(ctx, ownerID, in.CodeID, in.Label, in.AllowedOrigins)
		if err != nil {
			return nil, embedErr(err)
		}
		out := toEmbedOut(&created.Embed)
		out.PrivateKey = created.PrivateKey
		return json.Marshal(out)
	}
}

func updateEmbed(d EmbedsDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeEmbedArgs(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"embed_id", in.ID}); err != nil {
			return nil, err
		}
		e, err := d.Embeds.Update(ctx, ownerID, in.ID, in.Label, in.AllowedOrigins)
		if err != nil {
			return nil, embedErr(err)
		}
		return json.Marshal(toEmbedOut(&e))
	}
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
			fp.Conflict("code already exposed by an embed"), "code_already_embedded")
	}
	return fp.OpErr("embed op", err)
}
