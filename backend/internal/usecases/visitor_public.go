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
		CorpusPermissions: byoaiPublicOnlyPermissions(),
		BYOAIProvider:     in.BYOAIProvider,
		BYOAIKey:          in.BYOAIKey,
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return IssueCodeSessionResult{Session: issued, Conversation: conv}, nil
}

// byoaiPublicOnlyPermissions —— BYOAI / public-tier session 默认 ACL：
// 只允许 `public/**` path，其他全拒。owner 没办法给"无码访客"开放更多，
// 想要更多准入就要发 invite code（会带自己的 corpus_permissions）。
func byoaiPublicOnlyPermissions() []domain.PathPermission {
	return []domain.PathPermission{
		{Action: "allow", PathPattern: "public/**", Order: 1},
		{Action: "deny", PathPattern: "**", Order: 100},
	}
}

func publicTierForBYOAI(key string) string {
	if key != "" {
		return "byoai"
	}
	return "public"
}
