// visitor_code_intro.go —— the public peek the name picker does before session issue.
//
// Under defer-issue, after a visitor scans the code the name picker pops up first,
// before any session opens, but it still needs to show "what is this" (per-role greeting)
// and "how many people can use this code, how many have already." This use case doesn't
// open a session or create a member — it only reads code + role + member count and
// returns them.

package usecase

import (
	"context"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// CodeIntroResult —— for the name picker's display.
type CodeIntroResult struct {
	Label string
	// Greeting —— the role's own greeting, in the words the owner wrote. Empty = the role set
	// none; the picker then renders its default greeting in the visitor's UI language, from
	// Handle. The server assembles no sentence: one built here is in one language only (F-I-2).
	Greeting string
	Handle   string
	// MicrositeSlug —— which page this code opens. Empty = opens the default
	// visitor conversation (today's behavior). The landing decision is given here
	// because the frontend is **already** calling codes/intro when a visitor arrives
	// with a code: no need for another round trip just for "where to," and no need for
	// the page to ask itself "should I even exist."
	MicrositeSlug string
	MaxMembers    int32
	MemberCount   int32
}

// CodeIntro —— code → label + greeting (the role's; if empty, assembles a default from
// the owner handle) + max_members + existing member count. Invalid / revoked code →
// access.ErrCodeInvalid (the route translates it to 404).
func CodeIntro(
	ctx context.Context, deps *VisitorSessionDeps, codeStr string,
) (CodeIntroResult, error) {
	code, err := lookupAccessCode(ctx, deps, codeStr)
	if err != nil {
		return CodeIntroResult{}, err
	}
	count, cerr := deps.Codes.CountMembers(ctx, code.ID)
	if cerr != nil {
		return CodeIntroResult{}, fmt.Errorf("count members: %w", cerr)
	}
	return CodeIntroResult{
		Label:         code.Label,
		Greeting:      roleGreeting(ctx, deps, &code),
		Handle:        ownerHandleOrEmpty(ctx, deps, code.OwnerID),
		MicrositeSlug: code.MicrositeSlug,
		MaxMembers:    derefInt32(code.MaxMembers),
		MemberCount:   count,
	}, nil
}

// roleGreeting —— the greeting the code's role set; "" when it set none (or the role is gone).
func roleGreeting(ctx context.Context, deps *VisitorSessionDeps, code *access.Code) string {
	role, err := deps.Roles.GetByID(ctx, code.OwnerID, code.AssumedRoleID)
	if err != nil {
		return ""
	}
	return role.Greeting()
}

func ownerHandleOrEmpty(ctx context.Context, deps *VisitorSessionDeps, ownerID string) string {
	owner, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return ""
	}
	return owner.Handle
}

func derefInt32(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}
