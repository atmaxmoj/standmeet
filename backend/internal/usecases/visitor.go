// visitor.go —— visitor session 颁发（code tier）。chat / RAG / 流式那一半在
// visitor_chat.go；公开 (no-code) tier 颁发在 visitor_public.go。

package usecases

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/agentskills"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/inference"
	"github.com/atmaxmoj/standmeet/internal/postgres"
	"github.com/atmaxmoj/standmeet/internal/sandbox"
	"github.com/atmaxmoj/standmeet/internal/session"
)

// VisitorDeps —— visitor 用例所需。
//
// Resolver 替代之前的单例 Provider —— visitor chat 每次根据 owner_id 解算
// 该 owner 的真 provider（带自己的 key）；env=mock 时统一 fallback 到 mock
// 给 e2e/dev 用。
//
// A.3-IAM 起 Roles / Prompts 用于 session issue 时 freeze RoleSnapshot；
// code 没挂 assumed_role_id 走 legacy 路径，这两个仍然不能 nil 但调用时
// 会 short-circuit (buildRoleSnapshotForCode 检 nil)。
type VisitorDeps struct {
	Codes      *postgres.CodeRepo
	Chats      *postgres.ChatRepo
	Wiki       WikiLister
	Output     OutputLister
	Writings   WritingLister
	Owners     OwnerGetter
	Skills     SkillGetter
	MCPServers MCPServerGetter
	Roles      *postgres.RoleRepo
	Prompts    *postgres.PromptRepo
	// Calendar / GCal —— 可选 (admin 没装 connector 时 nil-tolerant)。
	// bookerBundle 在 buildBookerBundle 里检查 nil 并 silently skip。
	Calendar CalendarStore
	GCal     CalendarClient
	Sandbox  sandbox.Runner
	Sessions *session.VisitorSessionStore
	Queue    *session.QueryQueue
	Resolver inference.Resolver
	// AgentSkills —— Phase B Capability registry (visitor session 装配
	// retrieval / booker / ext-mcp / owner-skill tool 走它)。
	AgentSkills *agentskills.Registry
	// Reports —— I.3: summarize_conversation tool 落 chat_reports 行；
	// GET /report/{id} route 也通过它读。F.2: 窄接口 ReportStore 让 eval 能注
	// no-op 实现。
	Reports ReportStore
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
	// MaxMembers —— 这张码最多几个名字(0 = 不限);visitor UI 配 members 数渲
	// "N of M names"。
	MaxMembers int32 `json:"max_members"`
}

// IssueCodeSessionResult —— IssueCodeSession 返回的成对结果，避免 3-return。
// Code / VisitorName / Quota 让 visitor UI banner 一次拿全自描述信息，免
// 二次查询；public/byoai tier 时 Code 空、Quota 留 zero value。
// 字段顺序：重 sub-struct (Conversation / Session) 在前，slice 中，strings
// 后，int 末 —— 让 fieldalignment 满意。
type IssueCodeSessionResult struct {
	Session            session.IssuedVisitor
	Code               string
	CodeLabel          string
	VisitorName        string
	Chat               domain.Chat
	Members            []domain.CodeMember
	SuggestedQuestions []string
	Quota              SessionQuota
}

// codeSessionArtifacts —— issueCodeSessionArtifacts 返回打包，避免 3-return。
type codeSessionArtifacts struct {
	Issued session.IssuedVisitor
	Conv   domain.Chat
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
	members, merr := deps.Codes.ListMembers(ctx, code.ID)
	if merr != nil {
		members = nil
	}
	return IssueCodeSessionResult{
		Session: a.Issued, Chat: a.Conv,
		Code: code.Code, CodeLabel: code.Label, VisitorName: in.VisitorName,
		Members:            members,
		SuggestedQuestions: code.SuggestedQuestions,
		Quota:              codeSessionQuota(code),
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
	snapshot, serr := buildRoleSnapshotForCode(ctx, deps, code)
	if serr != nil {
		return codeSessionArtifacts{}, serr
	}
	sd := buildCodeSessionData(code, in.VisitorName, &snapshot)
	issued, err := deps.Sessions.Issue(ctx, sd)
	if err != nil {
		return codeSessionArtifacts{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return codeSessionArtifacts{Conv: conv, Issued: issued}, nil
}

func codeSessionQuota(code *domain.AccessCode) SessionQuota {
	q := SessionQuota{}
	if code.MaxTurnsPerSession != nil && *code.MaxTurnsPerSession > 0 {
		q.MaxTurns = *code.MaxTurnsPerSession
	}
	if code.MaxMembers != nil && *code.MaxMembers > 0 {
		q.MaxMembers = *code.MaxMembers
	}
	return q
}

// resolveMemberWithQuota —— upsert member by name，先过 max_members 闸:
// 满额(已有 N 个不同名字 >= MaxMembers)且这是个**新名字** → ErrMemberQuotaReached
// (visitor 见 "code 已满")；已有名字照常放行(续聊)。CodeMember 没有自己的
// revoked 状态，revoke 在 AccessCode 级别(code.status='revoked' → GetByCode
// 已经过滤掉 → 走不到这里)。
func resolveMemberWithQuota(
	ctx context.Context, deps *VisitorDeps, code *domain.AccessCode, name string,
) (domain.CodeMember, error) {
	members, lerr := deps.Codes.ListMembers(ctx, code.ID)
	if lerr != nil {
		return domain.CodeMember{}, fmt.Errorf("list members for quota: %w", lerr)
	}
	if quotaErr := checkMemberQuota(code, members, name); quotaErr != nil {
		return domain.CodeMember{}, quotaErr
	}
	member, merr := deps.Codes.GetOrCreateMember(ctx, code.ID, name)
	if merr != nil {
		return domain.CodeMember{}, fmt.Errorf("get/create member: %w", merr)
	}
	return member, nil
}

// checkMemberQuota —— max_members 闸。NULL/<=0 不限;已有名字放行(GetOrCreate
// 会续上它);新名字且已满 → 拒。匿名(name="")collapse 成一个 member,同样按
// "已有 vs 新"判。
func checkMemberQuota(code *domain.AccessCode, members []domain.CodeMember, name string) error {
	if code.MaxMembers == nil || *code.MaxMembers <= 0 {
		return nil
	}
	if memberExists(members, name) {
		return nil
	}
	if int32(len(members)) >= *code.MaxMembers {
		return domain.ErrMemberQuotaReached
	}
	return nil
}

func memberExists(members []domain.CodeMember, name string) bool {
	for i := range members {
		if members[i].DisplayName == name {
			return true
		}
	}
	return false
}

// createCodeConversation —— 「一个名字=一段续聊的会」:member 已有未结束的
// conversation 就续上;没有(新 member / 上一段已 summary 结束)才新建。
func createCodeConversation(
	ctx context.Context, deps *VisitorDeps,
	code *domain.AccessCode, member *domain.CodeMember, visitorName string,
) (domain.Chat, error) {
	existing, gerr := deps.Chats.GetOpenChatByMember(ctx, member.ID)
	if gerr == nil {
		return existing, nil
	}
	if !errors.Is(gerr, domain.ErrChatNotFound) {
		return domain.Chat{}, fmt.Errorf("look up member's open chat: %w", gerr)
	}
	memberID := member.ID
	chat, err := deps.Chats.CreateChat(ctx, &postgres.CreateChatInput{
		OwnerID:     code.OwnerID,
		Mode:        "code",
		CodeID:      &code.ID,
		MemberID:    &memberID,
		VisitorName: visitorName,
	})
	if err != nil {
		return domain.Chat{}, fmt.Errorf("create chat: %w", err)
	}
	return chat, nil
}

func buildCodeSessionData(
	code *domain.AccessCode, visitorName string, snapshot *domain.RoleSnapshot,
) *session.VisitorSessionData {
	return &session.VisitorSessionData{
		OwnerID:      code.OwnerID,
		Mode:         "code",
		CodeID:       code.ID,
		VisitorName:  visitorName,
		MaxBookings:  code.MaxBookings,
		RoleSnapshot: snapshot,
	}
}
