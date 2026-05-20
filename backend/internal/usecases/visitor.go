// visitor.go —— visitor session 颁发（code tier）。chat / RAG / 流式那一半在
// visitor_chat.go；公开 (no-code) tier 颁发在 visitor_public.go。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/session"
)

// VisitorDeps —— visitor 用例所需。
//
// Resolver 替代之前的单例 Provider —— visitor chat 每次根据 owner_id 解算
// 该 owner 的真 provider（带自己的 key）；env=mock 时统一 fallback 到 mock
// 给 e2e/dev 用。
type VisitorDeps struct {
	Codes    *postgres.CodeRepo
	Conv     *postgres.ConversationRepo
	Wiki     *postgres.WikiRepo
	Owners   *postgres.OwnerRepo
	Sessions *session.VisitorSessionStore
	Resolver inference.Resolver
}

// IssueCodeSessionInput —— code-tier 访客发起 session 的入参。
type IssueCodeSessionInput struct {
	Code        string
	VisitorName string
}

// IssueCodeSessionResult —— IssueCodeSession 返回的成对结果，避免 3-return。
type IssueCodeSessionResult struct {
	Session      session.IssuedVisitor
	Conversation domain.Conversation
}

// IssueCodeSession —— code-tier session 颁发：查 code → 校验 → 创 conversation
// + visitor session。
func IssueCodeSession(
	ctx context.Context, deps VisitorDeps, in *IssueCodeSessionInput,
) (IssueCodeSessionResult, error) {
	if in.Code == "" {
		return IssueCodeSessionResult{}, ErrEmptyField
	}
	code, err := lookupAccessCode(ctx, deps, in.Code)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	return finalizeCodeSession(ctx, deps, in, &code)
}

func lookupAccessCode(
	ctx context.Context, deps VisitorDeps, codeStr string,
) (domain.AccessCode, error) {
	code, err := deps.Codes.GetByCode(ctx, codeStr)
	if err != nil {
		if errors.Is(err, domain.ErrCodeInvalid) {
			return domain.AccessCode{}, domain.ErrCodeInvalid
		}
		return domain.AccessCode{}, fmt.Errorf("get code: %w", err)
	}
	return code, nil
}

func finalizeCodeSession(
	ctx context.Context, deps VisitorDeps,
	in *IssueCodeSessionInput, code *domain.AccessCode,
) (IssueCodeSessionResult, error) {
	member, qerr := resolveMemberWithQuota(ctx, deps, code, in.VisitorName)
	if qerr != nil {
		return IssueCodeSessionResult{}, qerr
	}
	conv, err := createCodeConversation(ctx, deps, code, &member, in.VisitorName)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	issued, err := deps.Sessions.Issue(ctx, buildCodeSessionData(code, in.VisitorName))
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return IssueCodeSessionResult{Session: issued, Conversation: conv}, nil
}

// resolveMemberWithQuota —— upsert member by name；配额超额翻译成 domain
// sentinel error。CodeMember 没有自己的 revoked 状态，revoke 在 AccessCode
// 级别（code.status='revoked' → GetByCode 已经过滤掉 → 走不到这里）。
func resolveMemberWithQuota(
	ctx context.Context, deps VisitorDeps, code *domain.AccessCode, name string,
) (domain.CodeMember, error) {
	member, merr := deps.Codes.GetOrCreateMember(ctx, code.ID, name)
	if merr != nil {
		return domain.CodeMember{}, fmt.Errorf("get/create member: %w", merr)
	}
	if quotaErr := checkSessionQuota(ctx, deps, code, member.ID); quotaErr != nil {
		return domain.CodeMember{}, quotaErr
	}
	return member, nil
}

func checkSessionQuota(
	ctx context.Context, deps VisitorDeps, code *domain.AccessCode, memberID string,
) error {
	if code.MaxSessionsPerMember == nil || *code.MaxSessionsPerMember <= 0 {
		return nil
	}
	count, err := deps.Conv.CountSessionsForMember(ctx, memberID)
	if err != nil {
		return fmt.Errorf("count member sessions: %w", err)
	}
	if count >= *code.MaxSessionsPerMember {
		return domain.ErrSessionQuotaReached
	}
	return nil
}

func createCodeConversation(
	ctx context.Context, deps VisitorDeps,
	code *domain.AccessCode, member *domain.CodeMember, visitorName string,
) (domain.Conversation, error) {
	memberID := member.ID
	conv, err := deps.Conv.CreateConversation(ctx, &postgres.CreateConvInput{
		OwnerID:     code.OwnerID,
		Tier:        "code",
		CodeID:      &code.ID,
		MemberID:    &memberID,
		VisitorName: visitorName,
	})
	if err != nil {
		return domain.Conversation{}, fmt.Errorf("create conversation: %w", err)
	}
	return conv, nil
}

func buildCodeSessionData(
	code *domain.AccessCode, visitorName string,
) *session.VisitorSessionData {
	return &session.VisitorSessionData{
		OwnerID:       code.OwnerID,
		Tier:          "code",
		CodeID:        code.ID,
		VisitorName:   visitorName,
		IncludedTags:  code.IncludedTags,
		ExcludedTags:  code.ExcludedTags,
		VisibilityMax: "private", // code-tier 可读 private wiki（owner 通过 code scope 控制）
	}
}
