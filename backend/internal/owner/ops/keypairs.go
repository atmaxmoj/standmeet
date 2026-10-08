// keypairs.go —— the owner's MCP keypairs: list / create / delete (refactor ledger R9: the admin
// route reached the owner facade directly; it now reads these ops from the dispatcher).
//
// Panel-only. create hands out a raw private key exactly once; and a keypair is the credential
// the MCP face authenticates with, so letting that face mint or revoke its own keys is circular.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

// Keypairs —— keypairs.list / create / delete.
func Keypairs(d usecase.KeypairDeps) []fp.Op {
	return []fp.Op{
		{
			ID: "keypairs.list", Description: "List the owner's MCP keypairs (metadata only).",
			InputSchema: noArgs, Kind: fp.Read,
			Reach:  fp.Only("credential bootstrap surface", "admin"),
			Invoke: listKeypairs(d),
		},
		{
			ID: "keypairs.create", Danger: fp.DangerCredential,
			Description: "Create an MCP keypair; the private key is returned once.",
			InputSchema: keypairCreateSchema, Kind: fp.Action,
			Reach:  fp.Only("issues a raw private key (Ed25519 PEM), shown once", "admin"),
			Invoke: createKeypair(d),
		},
		{
			ID: "keypairs.delete", Danger: fp.DangerDestructive,
			Description: "Revoke (hard-delete) an MCP keypair.",
			InputSchema: keypairIDSchema, Kind: fp.Action,
			Reach:  fp.Only("credential bootstrap surface", "admin"),
			Invoke: deleteKeypair(d),
		},
	}
}

var (
	keypairCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"label":{"type":"string"},
			"scopes":{"type":"array","items":{"type":"string"},
				"description":"Danger classes the key may use; omitted = every class."}
		},
		"required":["label"]
	}`)
	keypairIDSchema = json.RawMessage(`{
		"type":"object","properties":{"key_id":{"type":"string"}},"required":["key_id"]
	}`)
)

type keypairOut struct {
	LastUsedAt        *string  `json:"last_used_at"`
	LastUsedIP        *string  `json:"last_used_ip"`
	LastUsedUserAgent *string  `json:"last_used_user_agent"`
	KeyID             string   `json:"key_id"`
	Label             string   `json:"label"`
	CreatedAt         string   `json:"created_at"`
	Scopes            []string `json:"scopes"`
}

type keypairCreatedOut struct {
	KeyID         string   `json:"key_id"`
	PrivateKeyPEM string   `json:"private_key_pem"`
	Label         string   `json:"label"`
	CreatedAt     string   `json:"created_at"`
	Scopes        []string `json:"scopes"`
}

func listKeypairs(d usecase.KeypairDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		list, err := usecase.ListKeypairs(ctx, d, ownerID)
		if err != nil {
			return nil, err
		}
		out := make([]keypairOut, 0, len(list))
		for i := range list {
			out = append(out, keypairView(&list[i]))
		}
		return json.Marshal(out)
	}
}

func keypairView(k *entity.KeypairMetadata) keypairOut {
	v := keypairOut{
		KeyID: k.KeyID, Label: k.Label, Scopes: k.Scopes,
		CreatedAt:  k.CreatedAt.Format(time.RFC3339),
		LastUsedIP: k.LastUsedIP, LastUsedUserAgent: k.LastUsedUserAgent,
	}
	if k.LastUsedAt != nil {
		s := k.LastUsedAt.Format(time.RFC3339)
		v.LastUsedAt = &s
	}
	return v
}

func createKeypair(d usecase.KeypairDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			Label  string   `json:"label"`
			Scopes []string `json:"scopes"`
		}
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.Coded(fp.BadInput("invalid json body"), "invalid_body")
		}
		c, err := usecase.CreateKeypair(ctx, d, &usecase.CreateKeypairInputReq{
			OwnerID: ownerID, Label: in.Label, Scopes: in.Scopes,
		})
		if err != nil {
			return nil, keypairErr(err)
		}
		return json.Marshal(keypairCreatedOut{
			KeyID: c.Record.KeyID, PrivateKeyPEM: c.PrivateKeyPEM, Label: c.Record.Label,
			Scopes: c.Record.Scopes, CreatedAt: c.Record.CreatedAt.Format(time.RFC3339),
		})
	}
}

func deleteKeypair(d usecase.KeypairDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in struct {
			KeyID string `json:"key_id"`
		}
		if err := json.Unmarshal(raw, &in); err != nil || in.KeyID == "" {
			return nil, fp.BadInput("key_id is required")
		}
		if err := usecase.DeleteKeypair(ctx, d, ownerID, in.KeyID); err != nil {
			return nil, keypairErr(err)
		}
		return json.RawMessage(`{}`), nil
	}
}

// keypairErr —— the codes the panel route has always answered with.
func keypairErr(err error) error {
	switch {
	case errors.Is(err, apierr.ErrEmptyField):
		return fp.Coded(fp.BadInput("label is required"), "label_required")
	case errors.Is(err, usecase.ErrUnknownScope):
		return fp.Coded(fp.BadInput("a scope must be one of: read, write, destructive, "+
			"credential, authority, spend, egress"), "unknown_scope")
	case errors.Is(err, entity.ErrKeypairUnauthorized):
		return fp.Coded(fp.NotFound("keypair not found"), "keypair_not_found")
	}
	return err
}
