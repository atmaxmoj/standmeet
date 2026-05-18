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
type IssuePublicSessionInput struct {
	Handle        string
	VisitorName   string
	BYOAIProvider string // 'anthropic' | 'openai' | '' (无 BYOAI)
	BYOAIKey      string // visitor 自带 key；空 → 走 server-side provider
}

// IssuePublicSession —— public-tier session 颁发。
func IssuePublicSession(
	ctx context.Context, deps VisitorDeps, in *IssuePublicSessionInput,
) (IssueCodeSessionResult, error) {
	if in.Handle == "" {
		return IssueCodeSessionResult{}, ErrEmptyField
	}
	owner, err := lookupOwnerByHandle(ctx, deps, in.Handle)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	return finalizePublicSession(ctx, deps, in, &owner)
}

func lookupOwnerByHandle(
	ctx context.Context, deps VisitorDeps, handle string,
) (domain.Owner, error) {
	owner, err := deps.Owners.GetByHandle(ctx, handle)
	if err != nil {
		if errors.Is(err, domain.ErrOwnerNotFound) {
			return domain.Owner{}, domain.ErrOwnerNotFound
		}
		return domain.Owner{}, fmt.Errorf("get owner by handle: %w", err)
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
		OwnerID:       owner.ID,
		Tier:          tier,
		VisitorName:   in.VisitorName,
		VisibilityMax: "public",
		BYOAIProvider: in.BYOAIProvider,
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return IssueCodeSessionResult{Session: issued, Conversation: conv}, nil
}

func publicTierForBYOAI(key string) string {
	if key != "" {
		return "byoai"
	}
	return "public"
}
