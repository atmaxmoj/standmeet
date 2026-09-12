// block_ops.go — the owner's "what can visitors use" panel, declared by the block model
// itself and folded into the `blocks` resource alongside install / uninstall.
//
// This group has no domain to belong to: it reads the block registry and the seam
// slots, both of which live on the assembly-root side by design. So the declaration
// lives here too, not in the convergence layer (which only gathers each domain's front door).
//
// One row can be one of three kinds (distinguished by kind):
//
//	block     visitor-facing rows from the block registry (owner-only rows are excluded:
//	          the owner-enable gate only applies to visitor assembly, so a toggle on an
//	          owner-only row would do nothing)
//	supplier  platform-managed seam slots (calendar / mail); can be disabled, not deleted
//	skill     an owner-authored skill; its enabled reads the skill's own global toggle
//
// Before normalization, the MCP facade was missing two things the admin facade had:
// **the supplier row kind was entirely absent**, and dependency status gave only a single
// dependency_connected boolean with no name. So an owner looking at this table from Claude
// Code couldn't see the calendar/mail slots, and couldn't tell which supplier a block
// was waiting on. Now there's only one shape.

package blockwire

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// blockPanelOps — list / set_enabled / delete, on the `blocks` resource.
func blockPanelOps(d *deps.Runtime) []fp.Op {
	ops := newBlockOps(d)
	return []fp.Op{
		{
			ID: "blocks.list",
			Description: "List what visitors can use on this instance: registry " +
				"blocks, managed seam slots, and owner-authored skills — " +
				"each with its origin, enabled state and seam dependency status.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listBlocks(ops),
		},
		{
			ID: "blocks.set_enabled",
			Description: "Enable or disable one row. A disabled block never enters " +
				"a visitor session, even when a role attaches it.",
			InputSchema: blockEnabledSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setBlockEnabled(ops),
		},
		{
			ID: "blocks.delete",
			Description: "Remove a block the owner added: an installed block is " +
				"uninstalled, an owner-authored skill row is deleted. Built-in blocks " +
				"and managed suppliers cannot be removed.",
			InputSchema: blockRowIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteBlockRow(ops),
		},
	}
}

var (
	blockEnabledSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"Block / skill id."},
			"enabled":{"type":"boolean","description":"true to enable."}
		},
		"required":["id","enabled"]
	}`)

	blockRowIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"id":{"type":"string","description":"Owner-authored skill id."}},
		"required":["id"]
	}`)
)

// blockRow / blockDependency — one row in the table, and the seam it's waiting on.
type blockRow struct {
	Dependency *blockDependency `json:"dependency,omitempty"`
	ID         string           `json:"id"`
	Title      string           `json:"title,omitempty"`
	Origin     string           `json:"origin"`
	Kind       string           `json:"kind"`
	// Grants — the permissions this block carries, by name (today: "net").
	//
	// Sent so the owner assembling a bundle can SEE what a block reaches, which is the
	// entire argument for making a permission a block rather than a flag inside a
	// transport config. Only what it has: omission fails closed, so there is no
	// "net: off" and never an empty grant to explain away.
	Grants    []string `json:"grants"`
	Enabled   bool     `json:"enabled"`
	Deletable bool     `json:"deletable"`
}

type blockDependency struct {
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
}

// blockListOut — the list is wrapped in {"blocks": [...]} on every facade.
type blockListOut struct {
	Blocks []blockRow `json:"blocks"`
}

func listBlocks(ops blockOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := ops.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list blocks", err)
		}
		return json.Marshal(blockListOut{Blocks: rows})
	}
}

type blockEnabledArgs struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

func setBlockEnabled(ops blockOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in blockEnabledArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := ops.SetEnabled(ctx, ownerID, in.ID, in.Enabled); err != nil {
			return nil, fp.OpErr("set block enabled", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

type blockRowIDArgs struct {
	ID string `json:"id"`
}

func deleteBlockRow(ops blockOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in blockRowIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := ops.Delete(ctx, ownerID, in.ID); err != nil {
			return nil, err
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}
