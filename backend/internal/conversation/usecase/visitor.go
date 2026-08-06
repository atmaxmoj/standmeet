// visitor.go —— visitor session 颁发（code tier）。chat / RAG / 流式那一半在
// visitor_chat.go；公开 (no-code) tier 颁发在 visitor_public.go。

package usecase

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/entity"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// VisitorSessionDeps / VisitorSkillsDeps 拆到 visitor_deps.go 守 max-lines。

// IssueCodeSessionInput —— code-tier 访客发起 session 的入参。
// MemberID —— client 上次存的 member_id(尤其匿名者);带上就凭 id 续会,
// 失效则退到按 VisitorName / 新建匿名。
type IssueCodeSessionInput struct {
	Code         string
	VisitorName  string
	VisitorEmail string // 可选;访客进入时填的邮箱 → session profile
	MemberID     string
	ClientIP     string // 访客来源 IP（IP 感知）；空 = 未知
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
	Chat        entity.Chat
	Code        string
	CodeLabel   string
	VisitorName string
	MemberID    string
	Members     []access.CodeMember
	Ghosts      []string
	Session     access.IssuedVisitor
	Quota       SessionQuota
}

// codeSessionArtifacts —— issueCodeSessionArtifacts 返回打包，避免 3-return。
type codeSessionArtifacts struct {
	Conv   entity.Chat
	Member access.CodeMember
	Issued access.IssuedVisitor
}

// IssueCodeSession —— code-tier session 颁发：查 code → 校验 → 创 conversation
// + visitor session。
func IssueCodeSession(
	ctx context.Context, deps *VisitorSessionDeps, in *IssueCodeSessionInput,
) (IssueCodeSessionResult, error) {
	if in.Code == "" {
		return IssueCodeSessionResult{}, apierr.ErrEmptyField
	}
	code, err := lookupAccessCode(ctx, deps, in.Code)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	return finalizeCodeSession(ctx, deps, in, &code)
}

func lookupAccessCode(
	ctx context.Context, deps *VisitorSessionDeps, codeStr string,
) (access.Code, error) {
	code, err := deps.Codes.GetByCode(ctx, codeStr)
	if err != nil {
		if errors.Is(err, access.ErrCodeInvalid) {
			return access.Code{}, access.ErrCodeInvalid
		}
		return access.Code{}, fmt.Errorf("get code: %w", err)
	}
	return code, nil
}

func finalizeCodeSession(
	ctx context.Context, deps *VisitorSessionDeps,
	in *IssueCodeSessionInput, code *access.Code,
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
		Members:  members,
		Ghosts:   code.Ghosts,
		MemberID: a.Member.ID,
		Quota:    codeSessionQuotaWithUsed(ctx, deps, code, &a.Conv),
	}, nil
}

// codeSessionQuotaWithUsed —— 在静态配额(max)之上,把 UsedTurns 按后端实际数
// 出来。新模型下配额是 member 级:UsedTurns 汇总该 member **全部对话**的访客发言
// (countTurnsForQuota),续会/多 surface 颁发时如实报合计,不再恒 0 也不按单段对话
// 各算。数不出来(DB 抖)→ 退回 0。
func codeSessionQuotaWithUsed(
	ctx context.Context, deps *VisitorSessionDeps, code *access.Code,
	conv *entity.Chat,
) SessionQuota {
	q := codeSessionQuota(code)
	if used, err := countTurnsForQuota(ctx, deps, conv); err == nil {
		q.UsedTurns = used
	}
	return q
}

func issueCodeSessionArtifacts(
	ctx context.Context, deps *VisitorSessionDeps,
	in *IssueCodeSessionInput, code *access.Code,
) (codeSessionArtifacts, error) {
	member, qerr := resolveMemberWithQuota(ctx, deps, code, in)
	if qerr != nil {
		return codeSessionArtifacts{}, qerr
	}
	conv, err := createCodeConversation(ctx, deps, code, &member, in)
	if err != nil {
		return codeSessionArtifacts{}, err
	}
	snapshot, serr := buildRoleSnapshotForCode(ctx, deps, code)
	if serr != nil {
		return codeSessionArtifacts{}, serr
	}
	sd := buildCodeSessionData(code, access.VisitorProfile{
		Name: in.VisitorName, Email: in.VisitorEmail,
	}, member.ID, &snapshot)
	issued, err := deps.Sessions.Issue(ctx, sd)
	if err != nil {
		return codeSessionArtifacts{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return codeSessionArtifacts{Conv: conv, Issued: issued, Member: member}, nil
}

func codeSessionQuota(code *access.Code) SessionQuota {
	q := SessionQuota{}
	if code.MaxTurnsPerSession != nil && *code.MaxTurnsPerSession > 0 {
		q.MaxTurns = *code.MaxTurnsPerSession
	}
	if code.MaxMembers != nil && *code.MaxMembers > 0 {
		q.MaxMembers = *code.MaxMembers
	}
	return q
}

// resolveMemberWithQuota —— 三路解析 member:
//  1. client 带 member_id → 凭 id 续会(尤其匿名者,失效则往下退)。
//  2. 具名 → 按名字 upsert(满额闸只拦新名字;已有名字续会)。
//  3. 匿名(skip)→ 每人一个独立 guest member(满额闸:新匿名也占名额)。
//
// CodeMember 没有自己的 revoked 状态,revoke 在 AccessCode 级别(已被 GetByCode
// 过滤,走不到这里)。
func resolveMemberWithQuota(
	ctx context.Context, deps *VisitorSessionDeps,
	code *access.Code, in *IssueCodeSessionInput,
) (access.CodeMember, error) {
	resumed, rerr := resumeByMemberID(ctx, deps, code, in.MemberID)
	if rerr == nil {
		return resumed, nil
	}
	if !errors.Is(rerr, access.ErrMemberNotFound) {
		return access.CodeMember{}, fmt.Errorf("resume member by id: %w", rerr)
	}
	members, lerr := deps.Codes.ListMembers(ctx, code.ID)
	if lerr != nil {
		return access.CodeMember{}, fmt.Errorf("list members for quota: %w", lerr)
	}
	if in.VisitorName != "" {
		return resolveNamedMember(ctx, deps, code, members, in.VisitorName)
	}
	return resolveAnonMember(ctx, deps, code, members)
}

// resumeByMemberID —— member_id 空 / 查不到 → access.ErrMemberNotFound(caller
// 据此退到按名字 / 新建);查得到 → 返该 member 续会。
func resumeByMemberID(
	ctx context.Context, deps *VisitorSessionDeps, code *access.Code, memberID string,
) (access.CodeMember, error) {
	if memberID == "" {
		return access.CodeMember{}, access.ErrMemberNotFound
	}
	m, err := deps.Codes.GetMemberByID(ctx, memberID, code.ID)
	if err != nil {
		return access.CodeMember{}, fmt.Errorf("get member by id: %w", err)
	}
	return m, nil
}

func resolveNamedMember(
	ctx context.Context, deps *VisitorSessionDeps,
	code *access.Code, members []access.CodeMember, name string,
) (access.CodeMember, error) {
	if err := checkMemberQuota(code, members, name); err != nil {
		return access.CodeMember{}, err
	}
	m, err := deps.Codes.GetOrCreateMember(ctx, code.ID, name)
	if err != nil {
		return access.CodeMember{}, fmt.Errorf("get/create member: %w", err)
	}
	return m, nil
}

func resolveAnonMember(
	ctx context.Context, deps *VisitorSessionDeps,
	code *access.Code, members []access.CodeMember,
) (access.CodeMember, error) {
	if err := checkAnonQuota(code, members); err != nil {
		return access.CodeMember{}, err
	}
	m, err := deps.Codes.CreateAnonymousMember(ctx, code.ID)
	if err != nil {
		return access.CodeMember{}, fmt.Errorf("create anon member: %w", err)
	}
	return m, nil
}

// checkMemberQuota —— 具名版 max_members 闸:已有名字放行(续会);新名字且已满
// → 拒。checkAnonQuota —— 匿名版:每次都是新 member,满了就拒。
func checkMemberQuota(
	code *access.Code, members []access.CodeMember, name string,
) error {
	if code.MaxMembers == nil || *code.MaxMembers <= 0 {
		return nil
	}
	if memberExists(members, name) {
		return nil
	}
	if int32(len(members)) >= *code.MaxMembers {
		return access.ErrMemberQuotaReached
	}
	return nil
}

func checkAnonQuota(code *access.Code, members []access.CodeMember) error {
	if code.MaxMembers == nil || *code.MaxMembers <= 0 {
		return nil
	}
	if int32(len(members)) >= *code.MaxMembers {
		return access.ErrMemberQuotaReached
	}
	return nil
}

func memberExists(members []access.CodeMember, name string) bool {
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
	ctx context.Context, deps *VisitorSessionDeps,
	code *access.Code, member *access.CodeMember, in *IssueCodeSessionInput,
) (entity.Chat, error) {
	existing, gerr := deps.Chats.GetOpenChatByMember(ctx, member.ID)
	if gerr == nil {
		return existing, nil
	}
	if !errors.Is(gerr, entity.ErrChatNotFound) {
		return entity.Chat{}, fmt.Errorf("look up member's open chat: %w", gerr)
	}
	memberID := member.ID
	chat, err := deps.Chats.CreateChat(ctx, &repo.CreateChatInput{
		OwnerID:     code.OwnerID,
		Mode:        "code",
		CodeID:      &code.ID,
		MemberID:    &memberID,
		VisitorName: in.VisitorName,
		ClientIP:    in.ClientIP,
	})
	if err != nil {
		return entity.Chat{}, fmt.Errorf("create chat: %w", err)
	}
	return chat, nil
}

func buildCodeSessionData(
	code *access.Code, visitor access.VisitorProfile,
	memberID string, snapshot *access.RoleSnapshot,
) *access.VisitorSessionData {
	return &access.VisitorSessionData{
		OwnerID:      code.OwnerID,
		Mode:         "code",
		CodeID:       code.ID,
		MemberID:     memberID,
		Visitor:      visitor,
		RoleSnapshot: snapshot,
		ProviderID:   pickProviderID(code.ProviderID, snapshot.ProviderID()),
		GasMetered:   snapshot.GasMetered(),
	}
}

// pickProviderID —— **码压过 role**:码是发出去的那张票,是更具体的声明。
// 两个都没指 → 空串 = 用 owner 默认那条。这一步只在发会话时做一次,结果冻进 session。
func pickProviderID(codeProviderID, roleProviderID string) string {
	if codeProviderID != "" {
		return codeProviderID
	}
	return roleProviderID
}
