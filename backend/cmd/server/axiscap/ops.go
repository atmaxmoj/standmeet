// ops.go — resource capabilities: the owner's "what can visitors use" panel, declared by the
// **capability axis** itself.
//
// This group has no domain to belong to: it reads the capability registry and the connector
// slots — two plugin axes that by design live on the assembly-root side. So the declaration
// lives here too, not in the convergence layer (which only gathers each domain's front door).
//
// One row can be one of three kinds (distinguished by kind):
//
//	capability  visitor-facing rows from the capability registry (owner-only rows are excluded:
//	            the owner-enable gate only applies to visitor assembly, so a toggle on an
//	            owner-only row would do nothing)
//	connector   platform-managed connector slots (calendar / mail); can be disabled, not deleted
//	skill       an owner-authored skill; its enabled reads the skill's own global toggle
//
// Before normalization, the MCP facade was missing two things the admin facade had:
// **the connector row kind was entirely absent**, and dependency status gave only a single
// dependency_connected boolean with no name. So an owner looking at this table from Claude
// Code couldn't see the calendar/mail slots, and couldn't tell which connector a capability
// was waiting on. Now there's only one shape.

package axiscap

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CapabilityResource — list / set_enabled / delete.
func CapabilityResource(d *deps.Runtime) dispatcher.Resource {
	ops := newCapabilityOps(d)
	return dispatcher.Resource{Name: "capabilities", Ops: []fp.Op{
		{
			ID: "capabilities.list",
			Description: "List what visitors can use on this instance: registry " +
				"capabilities, managed connector slots, and owner-authored skills — " +
				"each with its origin, enabled state and connector dependency status.",
			InputSchema: fp.NoArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCapabilities(ops),
		},
		{
			ID: "capabilities.set_enabled",
			Description: "Enable or disable one row. A disabled capability never enters " +
				"a visitor session, even when a role attaches it.",
			InputSchema: capabilityEnabledSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCapabilityEnabled(ops),
		},
		{
			ID: "capabilities.delete",
			Description: "Delete an owner-authored skill row. Built-in capabilities and " +
				"managed connectors cannot be deleted.",
			InputSchema: capabilityRowIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteCapability(ops),
		},
	}}
}

var (
	capabilityEnabledSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"id":{"type":"string","description":"Capability / skill id."},
			"enabled":{"type":"boolean","description":"true to enable."}
		},
		"required":["id","enabled"]
	}`)

	capabilityRowIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"id":{"type":"string","description":"Owner-authored skill id."}},
		"required":["id"]
	}`)
)

// capabilityRow / capabilityDependency — one row in the table, and the connector it's waiting on.
type capabilityRow struct {
	Dependency *capabilityDependency `json:"dependency,omitempty"`
	ID         string                `json:"id"`
	Title      string                `json:"title,omitempty"`
	Origin     string                `json:"origin"`
	Kind       string                `json:"kind"`
	Enabled    bool                  `json:"enabled"`
	Deletable  bool                  `json:"deletable"`
}

type capabilityDependency struct {
	Name      string `json:"name"`
	Connected bool   `json:"connected"`
}

// capabilityListOut — admin has always sent this wrapped in {"capabilities": [...]}; that's
// an already-shipped contract, so every facade uses it.
type capabilityListOut struct {
	Capabilities []capabilityRow `json:"capabilities"`
}

func listCapabilities(ops capabilityOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := ops.List(ctx, ownerID)
		if err != nil {
			return nil, fp.OpErr("list capabilities", err)
		}
		return json.Marshal(capabilityListOut{Capabilities: rows})
	}
}

type capabilityEnabledArgs struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

func setCapabilityEnabled(ops capabilityOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in capabilityEnabledArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("invalid arguments: " + err.Error())
		}
		if err := fp.RequireArgs([2]string{"id", in.ID}); err != nil {
			return nil, err
		}
		if err := ops.SetEnabled(ctx, ownerID, in.ID, in.Enabled); err != nil {
			return nil, fp.OpErr("set capability enabled", err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

type capabilityRowIDArgs struct {
	ID string `json:"id"`
}

func deleteCapability(ops capabilityOps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in capabilityRowIDArgs
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
