// codes.go — resource codes: invitation codes the owner issues.
//
// A code is an entry point for one visitor identity: it points at a role (persona + corpus
// scope + blocks), then layers on the code's own quotas (how many people, turns per
// session), per-code ACL narrowing (see codes_acl.go), ghost-steering destinations
// (waypoints), and whether it forces cited evidence.
//
// Another block that wants to store its own config on a code (booker's booking quota was
// the first) goes through the CodeExtras seam — this domain does not know those blocks,
// see extras.go.

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

// CodesDeps — what the codes resource needs: the code's own use cases, the ACL-facet use
// cases, and the fields other blocks occupy on a code.
type CodesDeps struct {
	Extras CodeExtras
	Codes  usecase.CodesDeps
	ACL    usecase.CodeACLDeps
}

// Codes — the code itself + its ACL facet.
func Codes(d CodesDeps) []fp.Op {
	return append(codeCoreOps(d), codeACLOps(d.ACL)...)
}

func codeCoreOps(d CodesDeps) []fp.Op {
	extras := extrasOr(d.Extras)
	return []fp.Op{
		{
			ID: "codes.list",
			Description: "List the owner's access codes with their role, quotas, per-code " +
				"switches and attached ghosts.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCodes(d.Codes, extras),
		},
		{
			ID: "codes.create",
			Description: "Issue an access code against a role. The role decides persona, " +
				"corpus scope and blocks; the code adds its own quotas.",
			InputSchema: withExtraFields(codeCreateSchema, extras.Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createCode(d.Codes, extras),
		},
		{
			ID:          "codes.revoke",
			Description: "Revoke an access code. Existing sessions keep their frozen snapshot.",
			InputSchema: codeIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      revokeCode(d.Codes),
		},
		rotateOp(d),
		{
			ID: "codes.set_microsite",
			Description: "Point this code at a microsite, or clear it. Presenting the code " +
				"then opens that page instead of the default visitor chat — the page is a " +
				"rendering of the code, so the grant, quotas, identity prompt and transcript " +
				"are unchanged. An empty slug clears the binding. A code opens at most one page.",
			InputSchema: codePageSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCodeMicrosite(d.Codes),
		},
		{
			ID:          "codes.update_quotas",
			Description: "Change a code's quotas (members, turns per session, bookings).",
			InputSchema: withExtraFields(codeQuotaSchema, extras.Fields()),
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      updateCodeQuotas(d.Codes, extras),
		},
		{
			ID: "codes.set_ghost_evidence",
			Description: "Require (or stop requiring) cited evidence before the AI answers " +
				"on this code. null clears the per-code override and inherits the role's.",
			InputSchema: codeGhostSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCodeGhostEvidence(d.Codes, extras),
		},
		{
			ID:          "codes.list_members",
			Description: "List the visitors who have claimed this code.",
			InputSchema: codeIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listCodeMembers(d.Codes),
		},
	}
}

var (
	codeIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"code_id":{"type":"string","description":"Access code id."}},
		"required":["code_id"]
	}`)

	// codeCreateSchema — a JSON string cannot be wrapped (a literal newline inside one is
	// invalid JSON), so each description has to fit on its line. The `bundle` field's full
	// story does not: a bundle is read LIVE at assembly, so editing it moves every code
	// already bound to it, and a block removed from it is gone from an open session on the
	// next turn. That is the whole point of the bundle gate; the field's own description
	// says "read live" and this comment says what it buys.
	codeCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code":{"type":"string",
				"description":"The code string. Omit to derive one from the label (LABEL-XXX)."},
			"label":{"type":"string","description":"Who / what this code is for."},
			"purpose":{"type":"string","description":"Optional purpose tag."},
			"assumed_role_id":{"type":"string",
				"description":"Role this code assumes. Omit to use the owner's public role."},
			"ghosts":{"type":"array","items":{"type":"string"},
				"description":"Suggested questions shown to the visitor."},
			"prompt_id":{"type":"string","description":"Per-code prompt override."},
			"max_members":{"type":"integer","description":"How many visitors may claim it."},
			"max_turns_per_session":{"type":"integer","description":"Turn cap per session."},
			"expires_at":{"type":"string","description":"RFC3339 expiry; empty = never."},
			"provider_id":{"type":"string",
				"description":"Inference provider. Omit to inherit the role's, then the default."},
			"bundle":{"type":"string",
				"description":"Bundle this code carries, read live. Omit to use the role's grant."}
		},
		"required":[]
	}`)

	codeQuotaSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code id."},
			"max_members":{"type":["integer","null"],
				"description":"Omit to leave unchanged; null means no limit."},
			"max_turns_per_session":{"type":["integer","null"],
				"description":"Omit to leave unchanged; null means no limit."}
		},
		"required":["code_id"]
	}`)

	codeGhostSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code id."},
			"require_ghost_evidence":{"type":["boolean","null"],
				"description":"true / false, or null to inherit the role's setting."}
		},
		"required":["code_id"]
	}`)

	codePageSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"code_id":{"type":"string","description":"Access code id."},
			"slug":{"type":"string",
				"description":"Microsite slug; empty clears the binding."}
		},
		"required":["code_id"]
	}`)
)

func listCodes(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := deps.Codes.ListByOwner(ctx, ownerID)
		if err != nil {
			return nil, codeErr(err)
		}
		bundles := bundleNamesOrNone(ctx, deps, ownerID)
		out := make([]json.RawMessage, 0, len(rows))
		for i := range rows {
			rows[i].Bundle = bundles[rows[i].ID]
			one, merr := marshalCode(ctx, extras, &rows[i], countMembers(ctx, deps, rows[i].ID))
			if merr != nil {
				return nil, merr
			}
			out = append(out, one)
		}
		return json.Marshal(out)
	}
}

// bundleNamesOrNone — every code's bundle name in one read, or an empty table.
//
// Not fatal if it fails: the list is the owner's way in to everything else on a code, and
// losing the whole screen because one decorating column could not be read is a worse answer
// than a screen that shows no bundle.
func bundleNamesOrNone(
	ctx context.Context, deps usecase.CodesDeps, ownerID string,
) map[string]string {
	bundles, err := deps.Codes.BundleNames(ctx, ownerID)
	if err != nil {
		if deps.Log != nil {
			deps.Log.Warn("codes list: bundle names", "err", err)
		}
		return map[string]string{}
	}
	return bundles
}

func listCodeMembers(deps usecase.CodesDeps) fp.Invoke {
	return func(ctx context.Context, _ string, raw json.RawMessage) (json.RawMessage, error) {
		id, perr := parseCodeID(raw)
		if perr != nil {
			return nil, perr
		}
		rows, err := deps.Codes.ListMembers(ctx, id)
		if err != nil {
			return nil, codeErr(err)
		}
		out := make([]codeMemberOut, 0, len(rows))
		for i := range rows {
			out = append(out, codeMemberOut{
				ID: rows[i].ID, DisplayName: rows[i].DisplayName, Email: rows[i].Email,
				IsAnonymous: rows[i].IsAnonymous,
				LastSeenAt:  formatOptionalTime(&rows[i].LastSeenAt),
			})
		}
		return json.Marshal(out)
	}
}

type codeIDArgs struct {
	CodeID string `json:"code_id"`
}

func parseCodeID(raw json.RawMessage) (string, error) {
	var in codeIDArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return "", fp.BadInput("invalid arguments: " + err.Error())
	}
	return in.CodeID, fp.RequireArgs([2]string{"code_id", in.CodeID})
}

// codeErr — domain sentinel → protocol-agnostic category. code is an already-shipped
// contract, so it's pinned down explicitly.
func codeErr(err error) error {
	for _, c := range codeErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("code op", err)
}

var codeErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("code and assumed_role_id are required")
	}},
	{entity.ErrCodeInvalid, func() error {
		return fp.Coded(fp.NotFound("code not found"), "code_not_found")
	}},
	{entity.ErrCodeTaken, func() error {
		return fp.Coded(fp.Conflict("code already exists"), "code_taken")
	}},
	{entity.ErrDenialKindUnknown, func() error {
		return fp.BadInput("kind must be block, skill or corpus")
	}},
}
