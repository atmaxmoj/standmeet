// codes.go — the rules **for** issuing a code / revoking a code / changing quotas,
// themselves.
//
// These three used to be scattered across faces and the composition root:
//
//   - "no role specified → use the owner's public role" only lived on the admin
//     route, so the same operation coming in from MCP had to pass role_id explicitly.
//   - "revoking a code must also clear the visitor sessions it already issued" also
//     only lived on the admin route. Revoking from MCP left the codeholder's token
//     alive, blocked only once the next turn's per-turn check ran.
//   - "a field not mentioned in a quota update keeps its current value" only lived on
//     the MCP side (it read the row back and merged itself), because the SQL
//     underneath blind-writes both columns; the panel always sends the full set so
//     it never hit this, but any caller sending just one field would silently reset
//     the other to "unlimited".
//
// All three are **how the thing is computed**, not how some face presents it, so
// they live in the domain: the same regardless of which entry point they come from.

package usecase

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
)

// CodesDeps — repos needed by this group of code-issuing use cases. Roles is used to
// fall back to the public role; Sessions is used to clear issued visitor sessions
// when a code is revoked.
type CodesDeps struct {
	Codes    *repo.CodeRepo
	Roles    *repo.RoleRepo
	Sessions *VisitorSessionStore
}

// IssueCode — issues a code. AssumedRoleID left blank = use the owner's public role
// (the one seeded at the moment of claiming).
func IssueCode(
	ctx context.Context, d CodesDeps, in *repo.CreateCodeInput,
) (entity.Code, error) {
	roleID, err := assumedRoleOrInvited(ctx, d, in.OwnerID, in.AssumedRoleID)
	if err != nil {
		return entity.Code{}, err
	}
	in.AssumedRoleID = roleID
	code, cerr := d.Codes.Create(ctx, in)
	if cerr != nil {
		return entity.Code{}, fmt.Errorf("issue code: %w", cerr)
	}
	return code, nil
}

// assumedRoleOrInvited — the default role when the owner didn't specify one on this
// code.
//
// The default is `invited`, not public. **Issuing a code is itself an invitation** —
// this is the other half of the owner's own rule: "private content is unreadable
// without a code", which conversely means a codeholder can read the owner's curated
// corpus. public is reserved for the **no-code** path (BYOAI / gate), which reads
// only what's published (F-D-7).
//
// Giving someone only the public-facing slice is still possible: explicitly pick
// `public` on the code. The difference is that becomes a **deliberately chosen**
// decision, not an assumption made on the owner's behalf.
func assumedRoleOrInvited(
	ctx context.Context, d CodesDeps, ownerID, requested string,
) (string, error) {
	if requested != "" {
		return requested, nil
	}
	invited, err := d.Roles.GetByName(ctx, ownerID, entity.InvitedRoleName)
	if err != nil {
		return "", fmt.Errorf("invited role: %w", err)
	}
	return invited.ID(), nil
}

// RevokeCode — revokes a code, and clears the visitor sessions it already issued.
//
// Clearing sessions is the other half of revocation: without it, the codeholder's
// token stays alive, blocked only once the next turn's per-turn check runs. If
// clearing fails we still report only the error's back half — the code itself is
// already revoked, and that layer still blocks it.
func RevokeCode(ctx context.Context, d CodesDeps, ownerID, codeID string) error {
	if err := d.Codes.Revoke(ctx, ownerID, codeID); err != nil {
		return fmt.Errorf("revoke code: %w", err)
	}
	if err := d.Sessions.DeleteByCode(ctx, codeID); err != nil {
		return fmt.Errorf("revoke code: purge visitor sessions: %w", err)
	}
	return nil
}

// SetCodeMicrosite — which page this code opens. Empty slug = unbind, fall back to
// the default visitor chat.
//
// **Does not revoke the session** (unlike RevokeCode): changing what renders isn't
// revoking authorization, and someone mid-conversation shouldn't get kicked out. The
// new destination only applies the next time this code is brought in.
func SetCodeMicrosite(
	ctx context.Context, d CodesDeps, ownerID, codeID, slug string,
) (entity.Code, error) {
	code, err := d.Codes.SetMicrosite(ctx, ownerID, codeID, slug)
	if err != nil {
		return entity.Code{}, fmt.Errorf("set code microsite: %w", err)
	}
	return code, nil
}

// CodeQuotaUpdate — changes quotas. Each field has three states: not mentioned =
// keep current value, explicitly empty = unlimited.
//
// The SQL underneath blind-writes both columns, so "not mentioned" must be filled in
// here by reading back the current value — sending one fewer field would otherwise
// clear it, which no caller would ever expect.
type CodeQuotaUpdate struct {
	MaxTurnsPerSession OptionalQuota
	MaxMembers         OptionalQuota
	OwnerID            string
	CodeID             string
}

// OptionalQuota — a tri-state quota: Set=false means the caller didn't mention this
// field.
type OptionalQuota struct {
	Value *int32
	Set   bool
}

// or — falls back to the current value when not mentioned.
func (o OptionalQuota) or(current *int32) *int32 {
	if o.Set {
		return o.Value
	}
	return current
}

// UpdateCodeQuotas — merges then writes. Skips the read-back if both fields were
// mentioned.
func UpdateCodeQuotas(
	ctx context.Context, d CodesDeps, in *CodeQuotaUpdate,
) (entity.Code, error) {
	merged, err := mergedQuotas(ctx, d, in)
	if err != nil {
		return entity.Code{}, err
	}
	code, uerr := d.Codes.UpdateQuotas(
		ctx, in.OwnerID, in.CodeID, merged.turns, merged.members,
	)
	if uerr != nil {
		return entity.Code{}, fmt.Errorf("update code quotas: %w", uerr)
	}
	return code, nil
}

// quotaPair — the two values to write into that blind-write SQL.
type quotaPair struct {
	turns   *int32
	members *int32
}

func mergedQuotas(
	ctx context.Context, d CodesDeps, in *CodeQuotaUpdate,
) (quotaPair, error) {
	if in.MaxTurnsPerSession.Set && in.MaxMembers.Set {
		return quotaPair{
			turns: in.MaxTurnsPerSession.Value, members: in.MaxMembers.Value,
		}, nil
	}
	cur, gerr := d.Codes.GetByID(ctx, in.CodeID)
	if gerr != nil {
		return quotaPair{}, fmt.Errorf("update code quotas: %w", gerr)
	}
	if cur.OwnerID != in.OwnerID {
		return quotaPair{}, entity.ErrCodeInvalid
	}
	return quotaPair{
		turns:   in.MaxTurnsPerSession.or(cur.MaxTurnsPerSession),
		members: in.MaxMembers.or(cur.MaxMembers),
	}, nil
}
