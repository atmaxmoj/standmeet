// codes.go — resource codes: invitation codes the owner issues.
//
// A code is an entry point for one visitor identity: it points at a role (persona + corpus
// scope + capabilities), then layers on the code's own quotas (how many people, turns per
// session), per-code ACL narrowing (see codes_acl.go), ghost-steering destinations
// (waypoints), and whether it forces cited evidence.
//
// Another capability that wants to store its own config on a code (booker's booking quota was
// the first) goes through the CodeExtras seam — this domain does not know those capabilities,
// see extras.go.

package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// CodesDeps — what the codes resource needs: the code's own use cases, the ACL-facet use
// cases, and the fields other capabilities occupy on a code.
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
				"corpus scope and capabilities; the code adds its own quotas.",
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
		{
			ID: "codes.set_custom_page",
			Description: "Point this code at a custom page, or clear it. Presenting the code " +
				"then opens that page instead of the default visitor chat — the page is a " +
				"rendering of the code, so the grant, quotas, identity prompt and transcript " +
				"are unchanged. An empty slug clears the binding. A code opens at most one page.",
			InputSchema: codePageSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      setCodeCustomPage(d.Codes),
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
				"description":"Inference provider. Omit to inherit the role's, then the default."}
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
				"description":"Custom page slug; empty clears the binding."}
		},
		"required":["code_id"]
	}`)
)

// codeRow — outbound payload shape (identical on every facade).
//
// require_ghost_evidence and prompt_id are also here: before normalization the MCP shape was
// missing these two, so the owner couldn't tell from Claude Code whether a code forced cited
// evidence.
type codeRow struct {
	ExpiresAt            *string `json:"expires_at,omitempty"`
	MaxMembers           *int32  `json:"max_members,omitempty"`
	MaxTurnsPerSession   *int32  `json:"max_turns_per_session,omitempty"`
	RequireGhostEvidence *bool   `json:"require_ghost_evidence"`
	PromptID             *string `json:"prompt_id,omitempty"`
	CreatedAt            string  `json:"created_at"`
	ID                   string  `json:"id"`
	Code                 string  `json:"code"`
	Label                string  `json:"label"`
	Status               string  `json:"status"`
	AssumedRoleID        string  `json:"assumed_role_id"`
	// ProviderID — empty = this code didn't specify one, inherits the role's then falls back
	// to default. **Must be sent outbound**: a field the owner can write but not see means the
	// panel can only guess next time it opens.
	ProviderID string `json:"provider_id"`
	// CustomPageSlug — which page this code opens. **Empty string = opens the default visitor
	// chat**, not "failed to answer". The page side can see the code, this side can see the
	// page — a binding visible only one way, and people forget they made it.
	CustomPageSlug string   `json:"custom_page_slug"`
	Ghosts         []string `json:"ghosts"`
	// MemberCount — how many people have claimed it so far. **Sending the cap alone isn't
	// enough**: with only the cap, a full code and a brand-new code look identical in the
	// panel, while the visitor side is already blocked by member_quota_reached (F-D-2). The
	// visitor header always renders "1 / 5 names", but the owner side had no way to get this
	// number.
	MemberCount int32 `json:"member_count"`
}

func toCodeRow(c *entity.Code, memberCount int32) codeRow {
	return codeRow{
		ID: c.ID, Code: c.Code, Label: c.Label, Status: c.Status,
		AssumedRoleID: c.AssumedRoleID, ProviderID: c.ProviderID,
		Ghosts:     nonNilStrings(c.Ghosts),
		MaxMembers: c.MaxMembers, MaxTurnsPerSession: c.MaxTurnsPerSession,
		RequireGhostEvidence: c.RequireGhostEvidence, PromptID: c.PromptID,
		CreatedAt:      c.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt:      formatOptionalTime(c.ExpiresAt),
		CustomPageSlug: c.CustomPageSlug,
		MemberCount:    memberCount,
	}
}

// marshalCode — a code + its used quota + the fields other capabilities put on it.
//
// memberCount is counted by the caller and passed in: on a write path (issue / update quota /
// update ghost) the code was just touched, so counting once there is accurate; the list path
// counts once per code. Failing to count isn't fatal — see countMembers below.
func marshalCode(
	ctx context.Context, extras CodeExtras, c *entity.Code, memberCount int32,
) (json.RawMessage, error) {
	row, err := json.Marshal(toCodeRow(c, memberCount))
	if err != nil {
		return nil, fp.OpErr("encode code", err)
	}
	return withExtraValues(row, extras.Read(ctx, c.ID)), nil
}

// countMembers — how many people have joined on this code. Returns 0 rather than failing the
// whole request when the count can't be read: not being able to read one code's usage
// shouldn't stop the owner from opening the code list. 0 shows as "0 / N", which beats a full
// page error, but that also means it **must not** be used to decide "this code is empty" —
// whether a code is full is always decided by the backend's issue-time check
// (member_quota_reached).
func countMembers(ctx context.Context, deps usecase.CodesDeps, codeID string) int32 {
	n, err := deps.Codes.CountMembers(ctx, codeID)
	if err != nil {
		return 0
	}
	return n
}

func listCodes(deps usecase.CodesDeps, extras CodeExtras) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := deps.Codes.ListByOwner(ctx, ownerID)
		if err != nil {
			return nil, codeErr(err)
		}
		out := make([]json.RawMessage, 0, len(rows))
		for i := range rows {
			one, merr := marshalCode(ctx, extras, &rows[i], countMembers(ctx, deps, rows[i].ID))
			if merr != nil {
				return nil, merr
			}
			out = append(out, one)
		}
		return json.Marshal(out)
	}
}

// codeMemberOut — one visitor who has claimed this code. Shape matches what both facades
// already send (display_name / is_anonymous).
type codeMemberOut struct {
	LastSeenAt  *string `json:"last_seen_at,omitempty"`
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	Email       string  `json:"email,omitempty"`
	IsAnonymous bool    `json:"is_anonymous"`
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
		return fp.BadInput("kind must be capability, skill or corpus")
	}},
}
