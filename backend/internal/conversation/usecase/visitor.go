// visitor.go —— visitor session issuance (code tier). The chat / RAG / streaming half
// lives in visitor_chat.go; public (no-code) tier issuance lives in visitor_public.go.

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

// VisitorSessionDeps / VisitorSkillsDeps are split out to visitor_deps.go to stay under
// max-lines.

// IssueCodeSessionInput —— input for a code-tier visitor starting a session.
// MemberID —— the member_id the client saved last time (especially for anonymous
// visitors); if present, resumes the session by id, falling back to VisitorName / a new
// anonymous member if it's stale.
type IssueCodeSessionInput struct {
	Code         string
	VisitorName  string
	VisitorEmail string // optional; the email the visitor filled in on entry → session profile
	MemberID     string
	ClientIP     string // the visitor's source IP (IP-awareness); empty = unknown
}

// SessionQuota —— the turn quota for the current conversation; used by the visitor UI to
// render what's remaining. MaxTurns == 0 means unlimited (the owner didn't set
// max_turns_per_session on the code). UsedTurns starts at 0 (new conv); after each
// subsequent sendMessage the frontend increments it locally, no need for SSE to echo it
// back (a single visitor session grows linearly, the client can count it exactly).
type SessionQuota struct {
	MaxTurns  int32 `json:"max_turns"`
	UsedTurns int32 `json:"used_turns"`
	// MaxMembers —— how many names this code allows at most (0 = unlimited); the
	// visitor UI pairs it with the members count to render "N of M names".
	MaxMembers int32 `json:"max_members"`
}

// IssueCodeSessionResult —— the bundled result IssueCodeSession returns, to avoid a
// 3-return. Code / VisitorName / Quota let the visitor UI banner get all self-describing
// info in one shot, no follow-up query needed; for public/byoai tier, Code is empty and
// Quota keeps its zero value. Field order: the heavy sub-structs (Conversation /
// Session) first, slices in the middle, strings after, int last —— to keep fieldalignment
// happy.
type IssueCodeSessionResult struct {
	Chat      entity.Chat
	Code      string
	CodeLabel string
	// CustomPageSlug —— which page this code opens. **The landing decision travels
	// down with the issuance itself**, not asked again once the visitor arrives: every
	// path that redeems a code (/gate submission, the name picker) goes through this
	// exact call, and if only intro carries this field, a path that skips intro
	// silently falls back to the default conversation ([[copied-invalidation-goes-stale]]).
	// Empty string = opens the default conversation.
	CustomPageSlug string
	VisitorName    string
	MemberID       string
	Members        []access.CodeMember
	Ghosts         []string
	Session        access.IssuedVisitor
	Quota          SessionQuota
}

// codeSessionArtifacts —— the bundled return of issueCodeSessionArtifacts, to avoid a
// 3-return.
type codeSessionArtifacts struct {
	Conv   entity.Chat
	Member access.CodeMember
	Issued access.IssuedVisitor
}

// IssueCodeSession —— code-tier session issuance: looks up the code → validates →
// creates the conversation + visitor session.
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
		Code: code.Code, CodeLabel: code.Label, CustomPageSlug: code.CustomPageSlug,
		VisitorName: in.VisitorName,
		Members:     members,
		Ghosts:      code.Ghosts,
		MemberID:    a.Member.ID,
		Quota:       codeSessionQuotaWithUsed(ctx, deps, code, &a.Conv),
	}, nil
}

// codeSessionQuotaWithUsed —— on top of the static quota (max), fills in UsedTurns by
// actually counting it from the backend. Under the new model the quota is member-level:
// UsedTurns sums this member's visitor turns across **all conversations**
// (countTurnsForQuota); on resume / multi-surface issuance it reports the true total,
// no longer stuck at 0 nor counted per single conversation segment. Uncountable (DB
// hiccup) → falls back to 0.
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
	// Freezing the role snapshot + building the session data + resolving an unspecified
	// provider down to the default one are merged into one step —— all three can fail,
	// splitting them apart would push this function's cyclomatic complexity over the
	// limit, and they're really one thing anyway: "assemble this session."
	sd, sderr := resolveCodeSessionData(ctx, deps, code, &member, in)
	if sderr != nil {
		return codeSessionArtifacts{}, sderr
	}
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

// resolveMemberWithQuota —— resolves member via three paths:
//  1. client carries member_id → resume by id (especially anonymous ones; falls
//     through below if stale).
//  2. named → upsert by name (the quota gate only blocks new names; an existing name
//     resumes).
//  3. anonymous (skipped) → a separate guest member per person (quota gate: a new
//     anonymous member also consumes a slot).
//
// CodeMember has no revoked state of its own; revoke is at the AccessCode level
// (already filtered by GetByCode, never reaches here).
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

// resumeByMemberID —— member_id empty / not found → access.ErrMemberNotFound (the
// caller falls back to by-name / creating a new one accordingly); found → returns that
// member to resume.
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

// checkMemberQuota —— the named version of the max_members gate: an existing name
// passes (resume); a new name when already full → rejected. checkAnonQuota —— the
// anonymous version: every call is a new member, rejected once full.
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

// createCodeConversation —— "one name = one continuing conversation": if the member
// already has an unfinished conversation, resume it; only create a new one when there
// isn't one (new member / the previous one has already ended with a summary).
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

// pickProviderID —— **the code overrides the role**: the code is the ticket that was
// actually handed out, so it's the more specific declaration. Neither one specified →
// empty string = use the owner's default. This resolution happens once at session
// issuance and the result is frozen into the session.
func pickProviderID(codeProviderID, roleProviderID string) string {
	if codeProviderID != "" {
		return codeProviderID
	}
	return roleProviderID
}
