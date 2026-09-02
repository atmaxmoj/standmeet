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
	Label    string
	Greeting string
	// CustomPageSlug —— which page this code opens. Empty = opens the default
	// visitor conversation (today's behavior). The landing decision is given here
	// because the frontend is **already** calling codes/intro when a visitor arrives
	// with a code: no need for another round trip just for "where to," and no need for
	// the page to ask itself "should I even exist."
	CustomPageSlug string
	MaxMembers     int32
	MemberCount    int32
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
		Label:          code.Label,
		Greeting:       resolveCodeGreeting(ctx, deps, &code),
		CustomPageSlug: code.CustomPageSlug,
		MaxMembers:     derefInt32(code.MaxMembers),
		MemberCount:    count,
	}, nil
}

// resolveCodeGreeting —— uses the role's greeting if it set one, otherwise assembles a
// default from the owner handle.
func resolveCodeGreeting(
	ctx context.Context, deps *VisitorSessionDeps, code *access.Code,
) string {
	role, err := deps.Roles.GetByID(ctx, code.OwnerID, code.AssumedRoleID)
	if err == nil && role.Greeting() != "" {
		return role.Greeting()
	}
	return defaultGreeting(ownerHandleOrEmpty(ctx, deps, code.OwnerID))
}

func ownerHandleOrEmpty(ctx context.Context, deps *VisitorSessionDeps, ownerID string) string {
	owner, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return ""
	}
	return owner.Handle
}

func defaultGreeting(handle string) string {
	if handle == "" {
		return "Ask this AI anything — it answers in the owner's voice, grounded in real work."
	}
	return fmt.Sprintf(
		"This is %s's AI. Ask it anything — it answers in %s's voice, grounded in their real work.",
		handle, handle,
	)
}

func derefInt32(p *int32) int32 {
	if p == nil {
		return 0
	}
	return *p
}
