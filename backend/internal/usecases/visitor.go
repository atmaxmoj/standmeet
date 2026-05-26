// visitor.go —— visitor session 颁发（code tier）。chat / RAG / 流式那一半在
// visitor_chat.go；公开 (no-code) tier 颁发在 visitor_public.go。

package usecases

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/inference"
	"github.com/wangsijie/standmeet/internal/postgres"
	"github.com/wangsijie/standmeet/internal/sandbox"
	"github.com/wangsijie/standmeet/internal/session"
)

// VisitorDeps —— visitor 用例所需。
//
// Resolver 替代之前的单例 Provider —— visitor chat 每次根据 owner_id 解算
// 该 owner 的真 provider（带自己的 key）；env=mock 时统一 fallback 到 mock
// 给 e2e/dev 用。
type VisitorDeps struct {
	Codes      *postgres.CodeRepo
	Conv       *postgres.ConversationRepo
	Wiki       *postgres.WikiRepo
	Output     *postgres.OutputRepo
	Posts      *postgres.PostRepo
	Owners     *postgres.OwnerRepo
	Skills     *postgres.SkillRepo
	MCPServers *postgres.MCPServerRepo
	Sandbox    sandbox.Runner
	Sessions   *session.VisitorSessionStore
	Queue      *session.QueryQueue
	Resolver   inference.Resolver
}

// IssueCodeSessionInput —— code-tier 访客发起 session 的入参。
type IssueCodeSessionInput struct {
	Code        string
	VisitorName string
}

// SessionQuota —— 当前 conversation 的 turn 配额；visitor UI 用来渲剩余。
// MaxTurns == 0 表示无上限（owner 没在 code 上设 max_turns_per_session）。
// UsedTurns 初始 0（新 conv）；后续 sendMessage 之后 frontend 本地 +1，
// SSE 没必要再 echo（同一 visitor session 单线性增长，client 自己算准）。
type SessionQuota struct {
	MaxTurns  int32 `json:"max_turns"`
	UsedTurns int32 `json:"used_turns"`
}

// IssueCodeSessionResult —— IssueCodeSession 返回的成对结果，避免 3-return。
// Code / VisitorName / Quota 让 visitor UI banner 一次拿全自描述信息，免
// 二次查询；public/byoai tier 时 Code 空、Quota 留 zero value。
type IssueCodeSessionResult struct {
	Code         string
	VisitorName  string
	Conversation domain.Conversation
	Session      session.IssuedVisitor
	Quota        SessionQuota
}

// codeSessionArtifacts —— issueCodeSessionArtifacts 返回打包，避免 3-return。
type codeSessionArtifacts struct {
	Conv   domain.Conversation
	Issued session.IssuedVisitor
}

// IssueCodeSession —— code-tier session 颁发：查 code → 校验 → 创 conversation
// + visitor session。
func IssueCodeSession(
	ctx context.Context, deps *VisitorDeps, in *IssueCodeSessionInput,
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
	ctx context.Context, deps *VisitorDeps, codeStr string,
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
	ctx context.Context, deps *VisitorDeps,
	in *IssueCodeSessionInput, code *domain.AccessCode,
) (IssueCodeSessionResult, error) {
	a, err := issueCodeSessionArtifacts(ctx, deps, in, code)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	return IssueCodeSessionResult{
		Session: a.Issued, Conversation: a.Conv,
		Code: code.Code, VisitorName: in.VisitorName,
		Quota: codeSessionQuota(code),
	}, nil
}

func issueCodeSessionArtifacts(
	ctx context.Context, deps *VisitorDeps,
	in *IssueCodeSessionInput, code *domain.AccessCode,
) (codeSessionArtifacts, error) {
	member, qerr := resolveMemberWithQuota(ctx, deps, code, in.VisitorName)
	if qerr != nil {
		return codeSessionArtifacts{}, qerr
	}
	conv, err := createCodeConversation(ctx, deps, code, &member, in.VisitorName)
	if err != nil {
		return codeSessionArtifacts{}, err
	}
	skillPrompts, serr := loadCodeSkillPrompts(ctx, deps, code.ID)
	if serr != nil {
		return codeSessionArtifacts{}, serr
	}
	sd := buildCodeSessionData(code, in.VisitorName, skillPrompts)
	issued, err := deps.Sessions.Issue(ctx, sd)
	if err != nil {
		return codeSessionArtifacts{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return codeSessionArtifacts{Conv: conv, Issued: issued}, nil
}

func codeSessionQuota(code *domain.AccessCode) SessionQuota {
	if code.MaxTurnsPerSession != nil && *code.MaxTurnsPerSession > 0 {
		return SessionQuota{MaxTurns: *code.MaxTurnsPerSession}
	}
	return SessionQuota{}
}

// loadCodeSkillPrompts —— 拉 InviteCode 选中的 skill prompts，固化到 session
// 避免每次 chat 查 DB。skills 表的 ListSkillsForCode 已按 name asc 排好。
func loadCodeSkillPrompts(
	ctx context.Context, deps *VisitorDeps, codeID string,
) ([]string, error) {
	if deps.Skills == nil {
		return nil, nil
	}
	skills, err := deps.Skills.ListSkillsForCode(ctx, codeID)
	if err != nil {
		return nil, fmt.Errorf("list code skills: %w", err)
	}
	out := make([]string, 0, len(skills))
	for i := range skills {
		if p := strings.TrimSpace(skills[i].Prompt); p != "" {
			out = append(out, p)
		}
	}
	return out, nil
}

// resolveMemberWithQuota —— upsert member by name；配额超额翻译成 domain
// sentinel error。CodeMember 没有自己的 revoked 状态，revoke 在 AccessCode
// 级别（code.status='revoked' → GetByCode 已经过滤掉 → 走不到这里）。
func resolveMemberWithQuota(
	ctx context.Context, deps *VisitorDeps, code *domain.AccessCode, name string,
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
	ctx context.Context, deps *VisitorDeps, code *domain.AccessCode, memberID string,
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
	ctx context.Context, deps *VisitorDeps,
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
	code *domain.AccessCode, visitorName string, skillPrompts []string,
) *session.VisitorSessionData {
	return &session.VisitorSessionData{
		OwnerID:           code.OwnerID,
		Tier:              "code",
		CodeID:            code.ID,
		VisitorName:       visitorName,
		CorpusPermissions: code.CorpusPermissions,
		SkillPrompts:      skillPrompts,
	}
}
