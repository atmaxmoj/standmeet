// codes_row.go — the outbound shape of one code, and the member count that goes with it.
//
// Split out of codes.go, which had passed the max-lines ceiling, and along a real seam:
// codes.go declares the operations, this file answers "what does a code look like on the
// wire". Adding a field the owner can see touches only this file.

package ops

import (
	"context"
	"encoding/json"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
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
	// MicrositeSlug — which page this code opens. **Empty string = opens the default visitor
	// chat**, not "failed to answer". The page side can see the code, this side can see the
	// page — a binding visible only one way, and people forget they made it.
	MicrositeSlug string `json:"microsite_slug"`
	// Bundle — which bundle this code carries, by name. Empty = none, and the code is
	// judged by its role exactly as before. This is the field that makes "what can this
	// code do" readable off the codes list instead of simulated across three screens
	// (`docs/design/plugin/frontend.md` §3).
	Bundle string   `json:"bundle"`
	Ghosts []string `json:"ghosts"`
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
		CreatedAt:     c.CreatedAt.UTC().Format(time.RFC3339),
		ExpiresAt:     formatOptionalTime(c.ExpiresAt),
		MicrositeSlug: c.MicrositeSlug,
		Bundle:        c.Bundle,
		MemberCount:   memberCount,
	}
}

// marshalCode — a code + its used quota + the fields other blocks put on it.
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

// codeMemberOut — one visitor who has claimed this code. Shape matches what both facades
// already send (display_name / is_anonymous).
type codeMemberOut struct {
	LastSeenAt  *string `json:"last_seen_at,omitempty"`
	ID          string  `json:"id"`
	DisplayName string  `json:"display_name"`
	Email       string  `json:"email,omitempty"`
	IsAnonymous bool    `json:"is_anonymous"`
}
