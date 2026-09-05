// roles_write.go — arg decoding and forwarding for create / update a role (declared in
// roles.go).
//
// waypoints / dock_buttons are this domain's own structures, so they're decoded straight into
// domain types here — before normalization they had to pass through the convergence point
// once as opaque JSON, then get decoded a second time at the assembly root.

package ops

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

type roleWriteArgs struct {
	PromptID *string `json:"prompt_id"`
	// These two are **pointers**: a bare bool can't distinguish "not mentioned" from
	// "explicitly turned off", and both of these gates are safety switches — "must have
	// cited evidence before answering" was turned off as a side effect of a rename once
	// (F-Q-3). nil = leave unchanged.
	RequireGhostEvidence *bool `json:"require_ghost_evidence"`
	// GasMetered — whether this role has the gas meter attached (false = never sends a gas
	// query, same as today's path).
	GasMetered  *bool  `json:"gas_metered"`
	RoleID      string `json:"role_id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Greeting    string `json:"greeting"`
	// ProviderID — which provider this role uses (empty = owner default); the one set on
	// a code overrides it.
	ProviderID   string                    `json:"provider_id"`
	CorpusURIs   []string                  `json:"corpus_uris"`
	SkillIDs     []string                  `json:"skill_ids"`
	MCPServerIDs []string                  `json:"mcp_server_ids"`
	Waypoints    []entity.Waypoint         `json:"waypoints"`
	DockButtons  []entity.DockButtonConfig `json:"dock_buttons"`
}

func decodeRoleCreate(raw json.RawMessage) (roleWriteArgs, error) {
	var in roleWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, fp.RequireArgs([2]string{"name", in.Name})
}

// decodeRoleUpdate — same as create, plus the required role_id.
func decodeRoleUpdate(raw json.RawMessage) (roleWriteArgs, error) {
	in, err := decodeRoleCreate(raw)
	if err != nil {
		return in, err
	}
	return in, fp.RequireArgs([2]string{"role_id", in.RoleID})
}

// roleWriteApply — create and update differ only in which use case gets called; decoding,
// conversion, and response are identical.
type roleWriteApply func(
	ctx context.Context, deps usecase.RolesDeps, in *usecase.RoleWriteInput,
) (entity.Role, error)

func writeRole(
	d RolesDeps, extras RoleExtras, apply roleWriteApply,
	decode func(json.RawMessage) (roleWriteArgs, error),
) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decode(raw)
		if perr != nil {
			return nil, perr
		}
		if kerr := keepUnmentioned(ctx, d, ownerID, &in); kerr != nil {
			return nil, roleErr(kerr)
		}
		rl, err := apply(ctx, d.Roles, toRoleWriteInput(d, ownerID, &in))
		if err != nil {
			return nil, roleErr(err)
		}
		// Each capability's own fields: the whole raw input gets handed over for them to
		// pick from. A write failure doesn't roll back the role — the role is already
		// built, its settings can be changed later (a failure there is logged at that
		// layer).
		extras.Write(ctx, rl.ID(), raw)
		return marshalRole(ctx, d.Roles, extras, &rl)
	}
}

// boolOr — on the create path, not given means this default (the update path has already
// filled it in via keepUnmentioned).
func boolOr(p *bool, def bool) bool {
	if p == nil {
		return def
	}
	return *p
}

// keepUnmentioned — when **updating** a role, an authorization field not mentioned in the
// request keeps its current value.
//
// Why this has to work this way (F-Q-3): `role_update` only requires `role_id` + `name`, so
// when the owner's AI says "rename this role", that's all it sends. Before this fix, an
// absent field was always treated as "set to empty" — so **renaming a role would wipe its
// corpus ACL, strip its skills, strip its external MCP servers, and turn off the "must have
// cited evidence before answering" safety switch**, while the receipt reported success.
//
// **"Keep the current value" is the only choice here that doesn't invent authorization**: it
// never grants more than before, it only preserves what the owner already granted (compare
// [[invented-default-grants-privilege]] — what causes trouble is a default invented on the
// side, and a "silent revocation" is equally an authorization change nobody asked for).
//
// The create path doesn't go through here: a new role has no "current value" to keep, so an
// absent field being empty is correct there.
//
// Clearing is still possible, and the panel has always done it this way: **send `[]`
// explicitly**. JSON distinguishes "field absent" (nil) from "given an empty array" — all it
// takes is someone reading that distinction.
func keepUnmentioned(
	ctx context.Context, d RolesDeps, ownerID string, in *roleWriteArgs,
) error {
	if in.RoleID == "" {
		return nil // create: no prior value to keep
	}
	cur, err := usecase.GetRole(ctx, d.Roles, ownerID, in.RoleID)
	if err != nil {
		return err
	}
	keepGrants(&cur, in)
	keepSwitches(&cur, in)
	return nil
}

// keepIDs — "field absent in the request (nil) keeps the current value; given `[]` means
// explicit clear". Shared by all three id lists — copy-pasting the same logic three times
// means a missed spot goes unnoticed. A generic version is blocked by forbidigo: `any` is a
// banned word in business code.
func keepIDs(dst *[]string, cur []string) {
	if *dst == nil {
		*dst = cur
	}
}

// keepGrants — what this role has been granted (corpus ACL / skills / external servers /
// steering waypoints / dock buttons).
func keepGrants(cur *entity.Role, in *roleWriteArgs) {
	keepIDs(&in.CorpusURIs, cur.CorpusURIs())
	keepIDs(&in.SkillIDs, cur.SkillIDs())
	keepIDs(&in.MCPServerIDs, cur.MCPServerIDs())
	if in.Waypoints == nil {
		in.Waypoints = cur.Waypoints()
	}
	if in.DockButtons == nil {
		in.DockButtons = cur.DockButtons()
	}
}

// keepSwitches — the two switches on this role. Written separately not just to dodge the
// complexity ceiling: their **cost of a mistake differs** from the group above — one missing
// ACL entry is under-granting, while require_ghost_evidence getting turned off is
// **over-granting** (the AI can answer without evidence again).
func keepSwitches(cur *entity.Role, in *roleWriteArgs) {
	if in.RequireGhostEvidence == nil {
		v := cur.RequireGhostEvidence()
		in.RequireGhostEvidence = &v
	}
	if in.GasMetered == nil {
		v := cur.GasMetered()
		in.GasMetered = &v
	}
}

func toRoleWriteInput(d RolesDeps, ownerID string, in *roleWriteArgs) *usecase.RoleWriteInput {
	return &usecase.RoleWriteInput{
		OwnerID: ownerID, RoleID: in.RoleID, Name: in.Name, Description: in.Description,
		Greeting: in.Greeting, PromptID: in.PromptID,
		CorpusURIs:   nonNilStrings(in.CorpusURIs),
		SkillIDs:     nonNilStrings(in.SkillIDs),
		MCPServerIDs: nonNilStrings(in.MCPServerIDs),
		Waypoints:    nonNilWaypoints(in.Waypoints),
		DockButtons:  nonNilDockButtons(in.DockButtons),
		// Which capabilities may be mounted on dock buttons is answered by the capability
		// registry — asked fresh on every write, and **asked scoped to this role's
		// skills** (an `acl: role_granted` capability only counts once its skill grants it).
		DockableCapabilityIDs: d.ValidCapabilityIDs,
		RequireGhostEvidence:  boolOr(in.RequireGhostEvidence, false),
		ProviderID:            in.ProviderID,
		GasMetered:            boolOr(in.GasMetered, false),
	}
}

// roleErr — domain sentinel → protocol-agnostic category.
//
// The three mount-reference errors use this domain's own port sentinels (see
// usecase/role_ports.go): owner and marketplace already depend on access, so access
// recognizing their error names would become a reverse dependency.
func roleErr(err error) error {
	for _, c := range roleErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("role op", err)
}

// roleDeleteErr — delete and update share the one sentinel ErrRoleBuiltinImmutable, but the
// message shown to a person must match what's actually happening: deleting a builtin returns
// "cannot delete", not "cannot rename".
func roleDeleteErr(err error) error {
	if errors.Is(err, entity.ErrRoleBuiltinImmutable) {
		return fp.Coded(
			fp.Forbidden("builtin role cannot be deleted"), "role_builtin_immutable",
		)
	}
	return roleErr(err)
}

var roleErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error { return fp.BadInput("name is required") }},
	{entity.ErrTooManyDockButtons, func() error {
		return fp.BadInput("at most two dock buttons")
	}},
	{entity.ErrDockButtonEmptyTrigger, func() error {
		return fp.BadInput("dock button needs a trigger")
	}},
	// Both cases share this one message, and it's true for both: either the id is
	// misspelled, or this capability needs the role's skill to grant it and this role
	// hasn't granted it. The previous version said "unknown dock capability" — false
	// for the second case (that capability is installed fine on the instance), and the
	// owner would go hunting for a typo that doesn't exist (F-D-13).
	{entity.ErrUnknownDockCapability, func() error {
		return fp.BadInput(
			"this role can't show that capability — check the id, or grant it to the role's skills",
		)
	}},
	{usecase.ErrRefPromptNotFound, func() error {
		return fp.BadInput("prompt id not found for this owner")
	}},
	{usecase.ErrRefSkillNotFound, func() error {
		return fp.BadInput("one or more skill ids not found")
	}},
	{usecase.ErrRefMCPServerNotFound, func() error {
		return fp.BadInput("one or more mcp server ids not found")
	}},
	// The code on these three is an **already-shipped contract** (frontend / e2e branch
	// on the code), so it's pinned down explicitly — it can't fall back to the category
	// default of not_found / forbidden / conflict, which would say less in the payload.
	{entity.ErrRoleNotFound, func() error {
		return fp.Coded(fp.NotFound("role not found"), "role_not_found")
	}},
	{entity.ErrRoleBuiltinImmutable, func() error {
		return fp.Coded(
			fp.Forbidden("builtin role cannot be renamed"), "role_builtin_immutable",
		)
	}},
	{entity.ErrRoleNameTaken, func() error {
		return fp.Coded(fp.Conflict("role name already taken"), "role_name_taken")
	}},
}
