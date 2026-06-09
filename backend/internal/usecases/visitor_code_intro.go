// visitor_code_intro.go —— 名字选择器 pre-issue 的公开 peek。
//
// defer-issue 下,访客扫码后名字选择器先弹、还没开 session,但要展示「这是什么」
// (per-role greeting)和「这张码给几个人用、已用几个」。这条 usecase 不开 session、
// 不建 member,只读 code + role + member 数返回。

package usecases

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// CodeIntroResult —— 名字选择器展示用。
type CodeIntroResult struct {
	Label       string
	Greeting    string
	MaxMembers  int32
	MemberCount int32
}

// CodeIntro —— code → label + greeting(role 的;空则按 owner handle 拼默认)+
// max_members + 已有 member 数。code 无效 / 撤销 → domain.ErrCodeInvalid(route
// 翻 404)。
func CodeIntro(ctx context.Context, deps *VisitorDeps, codeStr string) (CodeIntroResult, error) {
	code, err := lookupAccessCode(ctx, deps, codeStr)
	if err != nil {
		return CodeIntroResult{}, err
	}
	count, cerr := deps.Codes.CountMembers(ctx, code.ID)
	if cerr != nil {
		return CodeIntroResult{}, fmt.Errorf("count members: %w", cerr)
	}
	return CodeIntroResult{
		Label:       code.Label,
		Greeting:    resolveCodeGreeting(ctx, deps, &code),
		MaxMembers:  derefInt32(code.MaxMembers),
		MemberCount: count,
	}, nil
}

// resolveCodeGreeting —— role 设了 greeting 就用,否则按 owner handle 拼默认。
func resolveCodeGreeting(ctx context.Context, deps *VisitorDeps, code *domain.AccessCode) string {
	role, err := deps.Roles.GetByID(ctx, code.OwnerID, code.AssumedRoleID)
	if err == nil && role.Greeting() != "" {
		return role.Greeting()
	}
	return defaultGreeting(ownerHandleOrEmpty(ctx, deps, code.OwnerID))
}

func ownerHandleOrEmpty(ctx context.Context, deps *VisitorDeps, ownerID string) string {
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
