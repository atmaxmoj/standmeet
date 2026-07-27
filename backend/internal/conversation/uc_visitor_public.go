// visitor_public.go —— public-tier + BYOAI-tier visitor session 颁发。
// 跟 visitor.go 拆开为了 max-lines（visitor.go 主体放 code-tier + chat
// streaming pipeline）。

package conversation

import (
	"context"
	"errors"
	"fmt"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
)

// IssuePublicSessionInput —— public-tier 访客（无 code）发起 session 的入参。
// BYOAI 走同一 usecase：tier=public（带 BYOAIProvider 则记 byoai），
// visibility 强制 public。BYOAI key 本身不在这里 —— browser 保管，
// chat 时 header X-BYOAI-Key 信封带过来。session 只记 provider 用于路由。
//
// 没有 Handle 字段：v1 单 owner instance，访客落到根 / 就是这位 owner。
type IssuePublicSessionInput struct {
	VisitorName   string
	VisitorEmail  string // 可选;访客进入时填的邮箱 → session profile
	BYOAIProvider string // 'anthropic' | 'openai' | '' (无 BYOAI)
	ClientIP      string // 访客来源 IP（IP 感知）；空 = 未知
}

// IssuePublicSession —— public-tier session 颁发。
func IssuePublicSession(
	ctx context.Context, deps *VisitorSessionDeps, in *IssuePublicSessionInput,
) (IssueCodeSessionResult, error) {
	soleOwner, err := loadSoleOwnerForVisitor(ctx, deps)
	if err != nil {
		return IssueCodeSessionResult{}, err
	}
	return finalizePublicSession(ctx, deps, in, &soleOwner)
}

// loadSoleOwnerForVisitor —— visitor.public 路径上的 sole-owner 解析。usecases/page.go
// 的 LoadSoleOwner 需要 PageDeps；visitor 这边只有 VisitorDeps，所以重复一次小
// helper 避免 deps 互相依赖。pre-claim → ErrOwnerNotFound 由 handler 翻译成 404。
func loadSoleOwnerForVisitor(
	ctx context.Context, deps *VisitorSessionDeps,
) (owner.Owner, error) {
	handle, err := deps.Owners.FirstHandle(ctx)
	if err != nil {
		return owner.Owner{}, fmt.Errorf("first owner handle: %w", err)
	}
	if handle == "" {
		return owner.Owner{}, owner.ErrOwnerNotFound
	}
	soleOwner, oerr := deps.Owners.GetByHandle(ctx, handle)
	if oerr != nil {
		if errors.Is(oerr, owner.ErrOwnerNotFound) {
			return owner.Owner{}, owner.ErrOwnerNotFound
		}
		return owner.Owner{}, fmt.Errorf("get sole owner: %w", oerr)
	}
	return soleOwner, nil
}

func finalizePublicSession(
	ctx context.Context, deps *VisitorSessionDeps,
	in *IssuePublicSessionInput, o *owner.Owner,
) (IssueCodeSessionResult, error) {
	// Mode 记 byoai/public(功能性,resolver/quota 在用);BYOAI 的具体 provider 是
	// visitor/session 的属性(前端 session-store + per-request cred),不落 conv 行。
	mode := publicModeForBYOAI(in.BYOAIProvider)
	chat, err := deps.Chats.CreateChat(ctx, &CreateChatInput{
		OwnerID:     o.ID,
		Mode:        mode,
		VisitorName: in.VisitorName,
		ClientIP:    in.ClientIP,
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("create chat: %w", err)
	}
	// A.3-IAM-5: public / byoai 也强制走 RoleSnapshot —— freeze owner 的
	// public role。owner 想限缩 byoai 就改 public 的 corpus_uris，或发
	// byoai-eligible code 挂别的 role（后者 TODO）。
	snapshot, sserr := buildRoleSnapshotForOwnerPublic(ctx, deps, o.ID)
	if sserr != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("freeze public snapshot: %w", sserr)
	}
	issued, err := deps.Sessions.Issue(ctx, &access.VisitorSessionData{
		OwnerID:      o.ID,
		Mode:         mode,
		Visitor:      access.VisitorProfile{Name: in.VisitorName, Email: in.VisitorEmail},
		RoleSnapshot: &snapshot,
	})
	if err != nil {
		return IssueCodeSessionResult{}, fmt.Errorf("issue visitor session: %w", err)
	}
	return IssueCodeSessionResult{
		Session: issued, Chat: chat,
		VisitorName: in.VisitorName,
		// Code 空 / Quota zero —— public/byoai 没 turn 上限，SessionStrip 看到
		// max=0 就不渲 gauge，BYOAI 走 visitor-paid · unlimited 文案。
	}, nil
}

func nullableProvider(p string) *string {
	if p == "" {
		return nil
	}
	return &p
}

// publicModeForBYOAI —— browser 在 session create 时通过 BYOAIProvider 字段
// 声明 "我自带 key"。provider 非空 → mode=byoai；区别走 conv audit + 计费。
func publicModeForBYOAI(provider string) string {
	if provider != "" {
		return "byoai"
	}
	return "public"
}
