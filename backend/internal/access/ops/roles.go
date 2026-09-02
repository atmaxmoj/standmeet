// roles.go — resource roles: the owner-defined "visitor identity archetype". A role bundles
// a prompt (persona), a corpus URI allowlist, selected skills, selected external MCP servers,
// plus a few per-role switches. Invitation codes are issued against a role; session start
// freezes a RoleSnapshot, so editing a role afterward only affects future sessions.
//
// Before normalization this was the resource where the two facades diverged the most: admin's
// role always carried waypoints, dock_buttons, require_ghost_evidence, and the active-code
// count; MCP's role_list gave only the count, and role_update couldn't even accept those
// switches — meaning the owner **couldn't change, and couldn't see**, a safety-relevant
// per-role switch like require_ghost_evidence from Claude Code. Now there's only one shape.
//
// A capability's own per-role settings (calendar.book's notify_owner) aren't part of this
// domain's shape; they're merged in through the Extras seam — this domain doesn't even know
// their names.
//
// Op ids keep their historical names (role_create rather than roles.create).

package ops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// RolesDeps — role use cases + "which capabilities may be mounted on dock buttons".
//
// ValidCapabilityIDs is **lazy**: the capability registry isn't complete until every plugin is
// installed, and the convergence point is built before that. Storing a function rather than a
// snapshot avoids dock buttons getting an empty table of valid capabilities.
//
// **It answers scoped to the skill list being written this time**: an `acl: role_granted`
// capability only shows up in the session once this role's skills actually grant it. This used
// to ask "which visitor capabilities does this instance register", which was broader than the
// session side — a capability in the gap between the two would be accepted on the backend but
// never shown to the visitor, and neither side would say anything about it (F-D-13).
type RolesDeps struct {
	Roles              usecase.RolesDeps
	ValidCapabilityIDs func(ctx context.Context, ownerID string, skillIDs []string) []string
	// Extras — the fields each capability occupies on a role (calendar.book's notify_owner
	// was the first). access doesn't know any capability, only this seam. nil = no
	// capability has declared per-role config.
	Extras RoleExtras
}

// Roles — list / get / create / update / delete / set_dock_buttons.
func Roles(d RolesDeps) []fp.Op {
	extras := extrasOr(d.Extras)
	return []fp.Op{
		{
			ID: "role_list",
			Description: "List the owner's roles (incl. public builtin) with their corpus " +
				"URIs, attached skills / mcp servers, per-role switches and active code count.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listRoles(d),
		},
		{
			ID:          "roles.get",
			Description: "Read one role in full by id.",
			InputSchema: roleIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      getRole(d),
		},
		{
			ID: "role_create",
			Description: "Create an owner-curated Role (visitor identity archetype). " +
				"A role bundles a Prompt (persona) + a positive-list of corpus URI globs " +
				"+ selected skills + selected MCP servers. Issue access codes against this " +
				"role; session start freezes a RoleSnapshot — edits only affect future sessions.",
			InputSchema: withExtraFields(roleWriteSchema(roleCreateRequired), extras.Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeRole(d, extras, usecase.CreateRole, decodeRoleCreate),
		},
		{
			ID: "role_update",
			Description: "Update an owner-curated Role. Mirrors role_create fields plus " +
				"role_id. Re-sets the prompt / corpus URIs / skills / mcp servers / " +
				"per-role switches. Builtin (public) role can be edited but not renamed.",
			InputSchema: withExtraFields(roleWriteSchema(roleUpdateRequired), extras.Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      writeRole(d, extras, usecase.UpdateRole, decodeRoleUpdate),
		},
		{
			ID: "role_delete",
			Description: "Delete an owner-curated role. Public builtin cannot be deleted. " +
				"Roles in use by active codes are FK-restricted from deletion — " +
				"reassign or revoke codes first.",
			InputSchema: roleIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteRole(d.Roles),
		},
		{
			ID: "roles.set_dock_buttons",
			Description: "Set a role's chat dock buttons (#109/#110): at most two " +
				"{capability_id, trigger}. Clicking a button sends its trigger phrase as the " +
				"visitor's message. capability_id must be a visitor-facing capability this " +
				"instance exposes; trigger must be non-empty.",
			InputSchema: dockButtonsSchema,
			Kind:        fp.Action,
			Reach: fp.Only(
				"chat-dock UI hint; on admin it is folded into the role update body", "mcp",
			),
			Invoke: setRoleDockButtons(d),
		},
	}
}

const (
	roleCreateRequired = `"name"`
	roleUpdateRequired = `"role_id","name"`
)

var (
	roleIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"role_id":{"type":"string","description":"Role id"}},
		"required":["role_id"]
	}`)

	dockButtonsSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"role_id":{"type":"string","description":"Target role id."},
			"buttons":{"type":"array","maxItems":2,
				"description":"Up to two dock buttons.",
				"items":{"type":"object",
					"properties":{"capability_id":{"type":"string"},"trigger":{"type":"string"}},
					"required":["capability_id","trigger"]}}
		},
		"required":["role_id","buttons"]
	}`)
)

func roleWriteSchema(required string) json.RawMessage {
	return json.RawMessage(`{
		"type":"object",
		"properties":{
			"role_id":{"type":"string","description":"Target role id (update only)."},
			"name":{"type":"string","description":"Role name, unique per owner."},
			"description":{"type":"string",
				"description":"Optional one-line description of when to use this role."},
			"greeting":{"type":"string",
				"description":"Greeting on visitor picker; owner's AI intro. Blank=default."},
			"prompt_id":{"type":"string","description":"Optional prompt id for persona overlay."},
			"corpus_uris":{"type":"array","items":{"type":"string"},
				"description":"URI glob positive-list. raw://** always denied to visitors."},
			"skill_ids":{"type":"array","items":{"type":"string"},
				"description":"Skill ids to attach."},
			"mcp_server_ids":{"type":"array","items":{"type":"string"},
				"description":"External MCP server ids to expose."},
			"waypoints":{"type":"array","items":{"type":"object"},
				"description":"Ghost-steering destinations for this role."},
			"dock_buttons":{"type":"array","maxItems":2,"items":{"type":"object"},
				"description":"Up to two chat dock buttons {capability_id, trigger}."},
			"require_ghost_evidence":{"type":"boolean",
				"description":"Require cited evidence before the AI answers on this role."},
			"provider_id":{"type":"string",
				"description":"Inference provider. Omit for the default; a code outranks it."},
			"gas_metered":{"type":"boolean",
				"description":"Charge this role's turns against its provider's gas tank."}
		},
		"required":[` + required + `]
	}`)
}

// roleOut — outbound payload shape (identical on every facade; it's the contract admin has
// already shipped).
type roleOut struct {
	CreatedAt            string                    `json:"created_at"`
	UpdatedAt            string                    `json:"updated_at"`
	PromptID             *string                   `json:"prompt_id,omitempty"`
	ID                   string                    `json:"id"`
	Name                 string                    `json:"name"`
	Description          string                    `json:"description"`
	Greeting             string                    `json:"greeting"`
	ProviderID           string                    `json:"provider_id"`
	CorpusURIs           []string                  `json:"corpus_uris"`
	SkillIDs             []string                  `json:"skill_ids"`
	MCPServerIDs         []string                  `json:"mcp_server_ids"`
	Waypoints            []entity.Waypoint         `json:"waypoints"`
	DockButtons          []entity.DockButtonConfig `json:"dock_buttons"`
	ActiveCodes          int64                     `json:"active_codes"`
	IsBuiltin            bool                      `json:"is_builtin"`
	RequireGhostEvidence bool                      `json:"require_ghost_evidence"`
	GasMetered           bool                      `json:"gas_metered"`
}

// marshalRole — outbound payload = this domain's shape + the values of the fields each
// capability puts on this role.
//
// The same thing as marshalCode, on a different subject. A capability's values are **merged
// in**, not fields of this struct — access doesn't know their names, so they can't appear on
// roleOut. notify_owner_on_booking used to sit right there, and had grown all the way into the
// kernel's roles table.
func marshalRole(
	ctx context.Context, deps usecase.RolesDeps, extras SubjectExtras, rl *entity.Role,
) (json.RawMessage, error) {
	row, err := json.Marshal(toRoleOut(ctx, deps, rl))
	if err != nil {
		return nil, fp.OpErr("encode role", err)
	}
	return withExtraValues(row, extras.Read(ctx, rl.ID())), nil
}

// toRoleOut — domain entity → outbound shape, filling in the active-code count along the way.
// A count failure shouldn't fail the whole read (it's display-only corroboration); record 0
// and continue — this is how the admin facade has always behaved.
func toRoleOut(ctx context.Context, deps usecase.RolesDeps, rl *entity.Role) roleOut {
	count, cerr := usecase.CountActiveCodesForRole(ctx, deps, rl.OwnerID(), rl.ID())
	if cerr != nil {
		count = 0
	}
	out := roleOut{
		ID: rl.ID(), Name: rl.Name(), Description: rl.Description(),
		Greeting: rl.Greeting(), CorpusURIs: nonNilStrings(rl.CorpusURIs()),
		SkillIDs: nonNilStrings(rl.SkillIDs()), MCPServerIDs: nonNilStrings(rl.MCPServerIDs()),
		ActiveCodes: count, IsBuiltin: rl.IsBuiltin(),
		RequireGhostEvidence: rl.RequireGhostEvidence(),
		ProviderID:           rl.ProviderID(),
		GasMetered:           rl.GasMetered(),
		CreatedAt:            rl.CreatedAt().UTC().Format(time.RFC3339),
		UpdatedAt:            rl.UpdatedAt().UTC().Format(time.RFC3339),
		Waypoints:            nonNilWaypoints(rl.Waypoints()),
		DockButtons:          nonNilDockButtons(rl.DockButtons()),
	}
	if pid, ok := rl.PromptID(); ok {
		out.PromptID = &pid
	}
	return out
}

func nonNilDockButtons(in []entity.DockButtonConfig) []entity.DockButtonConfig {
	if in == nil {
		return []entity.DockButtonConfig{}
	}
	return in
}

func listRoles(d RolesDeps) fp.Invoke {
	extras := extrasOr(d.Extras)
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListRoles(ctx, d.Roles, ownerID)
		if err != nil {
			return nil, roleErr(err)
		}
		out := make([]json.RawMessage, 0, len(rows))
		for i := range rows {
			row, merr := marshalRole(ctx, d.Roles, extras, &rows[i])
			if merr != nil {
				return nil, merr
			}
			out = append(out, row)
		}
		return json.Marshal(out)
	}
}

type roleIDArgs struct {
	RoleID string `json:"role_id"`
}

func parseRoleID(raw json.RawMessage) (string, error) {
	var in roleIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.RoleID, fp.RequireArgs([2]string{"role_id", in.RoleID})
}

func getRole(d RolesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseRoleID(raw)
		if perr != nil {
			return nil, perr
		}
		rl, err := usecase.GetRole(ctx, d.Roles, ownerID, id)
		if err != nil {
			return nil, roleErr(err)
		}
		return marshalRole(ctx, d.Roles, extrasOr(d.Extras), &rl)
	}
}

func deleteRole(deps usecase.RolesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseRoleID(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.DeleteRole(ctx, deps, ownerID, id); err != nil {
			return nil, roleDeleteErr(err)
		}
		return json.Marshal(map[string]bool{"ok": true})
	}
}

type dockButtonsArgs struct {
	RoleID  string                    `json:"role_id"`
	Buttons []entity.DockButtonConfig `json:"buttons"`
}

func setRoleDockButtons(d RolesDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in dockButtonsArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, fp.BadInput("dock_buttons must be an array of {capability_id, trigger}")
		}
		if err := fp.RequireArgs([2]string{"role_id", in.RoleID}); err != nil {
			return nil, err
		}
		rl, err := usecase.SetRoleDockButtons(ctx, d.Roles, &usecase.SetDockButtonsInput{
			OwnerID: ownerID, RoleID: in.RoleID, Buttons: nonNilDockButtons(in.Buttons),
			DockableCapabilityIDs: d.ValidCapabilityIDs,
		})
		if err != nil {
			return nil, roleErr(err)
		}
		return marshalRole(ctx, d.Roles, extrasOr(d.Extras), &rl)
	}
}
