// visitor_public.go —— public-tier + BYOAI-tier visitor session 颁发。
// 跟 visitor.go 拆开为了 max-lines（visitor.go 主体放 code-tier + chat
// streaming pipeline）。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

// IssuePublicSessionInput —— public-tier 访客（无 code）发起 session 的入参。
// BYOAI 走同一 usecase：tier=public（带 key 则记 byoai），visibility 强制
// public，BYOAIProvider/Key 透传到 session data。
//
// 没有 Handle 字段：v1 单 owner instance，访客落到根 / 就是这位 owner。
type IssuePublicSessionInput struct {
	VisitorName   string
	BYOAIProvider string // 'anthropic' | 'openai' | '' (无 BYOAI)
	BYOAIKey      string // visitor 自带 key；空 → 走 server-side provider
}

// IssuePublicSession —— public-tier session 颁发。
func IssuePublicSession(
	ctx context.Context, deps VisitorDeps, in *IssuePublicSessionInput,
) (IssueCodeSessionResult, error) {
	owner, err := loadSoleOwnerForVisitor(ctx, deps)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	return finalizePublicSession(ctx, deps, in, &owner)
}

// loadSoleOwnerForVisitor —— visitor.public 路径上的 sole-owner 解析。usecases/page.go
// 的 LoadSoleOwner 需要 PageDeps；visitor 这边只有 VisitorDeps，所以重复一次小
// helper 避免 deps 互相依赖。pre-claim → ErrOwnerNotFound 由 handler 翻译成 404。
func loadSoleOwnerForVisitor(
	ctx context.Context, deps VisitorDeps,
) (domain.Owner, error) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil {
		return domain.Owner{}, fmt.Errorf("first owner handle: %w", err)
	}
	if handle == "" {
		return domain.Owner{}, domain.ErrOwnerNotFound
	}
	owner, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		if errors.Is(oerr, domain.ErrOwnerNotFound) {
			return domain.Owner{}, domain.ErrOwnerNotFound
		}
		return domain.Owner{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return owner, nil
}

func finalizePublicSession(
	ctx context.Context, deps VisitorDeps,
	in *IssuePublicSessionInput, owner *domain.Owner,
) (IssueCodeSessionResult, error) {
	tier := publicTierForBYOAI(in.BYOAIKey)
	conv, err := deps.Conv.CreateConversation(ctx, &postgres.CreateConvInput{
		OwnerID:     owner.ID,
		Tier:        tier,
		VisitorName: in.VisitorName,
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("create conversation: %w", err)
	}
	issued, err := deps.Sessions.Issue(ctx, &session.VisitorSessionData{
		OwnerID:           owner.ID,
		Tier:              tier,
		VisitorName:       in.VisitorName,
		CorpusPermissions: defaultPermsForTier(tier),
		BYOAIProvider:     in.BYOAIProvider,
		BYOAIKey:          in.BYOAIKey,
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return IssueCodeSessionResult{Session: issued, Conversation: conv}, nil
}

// defaultPermsForTier —— 无 access code 时的兜底准入策略。
//   - public：unrestricted（owner 没设 code 时访客就能看完整 corpus；如果
//     owner 想限缩，就发 code 带 corpus_permissions）。
//   - byoai：visitor 自带 key，owner 不为推理付钱也不该让 visitor 自由
//     翻 corpus —— 默认 `public/**` only，owner 把开放内容组织在
//     `public/...` path 下；想要更细就发 byoai-eligible code (TODO)。
func defaultPermsForTier(tier string) []domain.PathPermission {
	if tier == "byoai" {
		return []domain.PathPermission{
			{Action: "allow", PathPattern: "public/**", Order: 1},
			{Action: "deny", PathPattern: "**", Order: 100},
		}
	}
	return nil
}

func publicTierForBYOAI(key string) string {
	if key != "" {
		return "byoai"
	}
	return "public"
}
