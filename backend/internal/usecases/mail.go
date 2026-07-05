// mail.go —— 出站 mail connector 的业务逻辑:approve 闭环(批准 gate 请求 →
// issue AccessCode → 邮件发 requester)。
//
// 发信走 MailProxy(连接器代调，SMTP 凭据不出 vault)。approve 复用 codes /
// roles / owners repo,跟 job-loop 的 applications.commit 自动发码同范式。

package usecases

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

const (
	inviteCodePrefix   = "inv"
	inviteCodeRandSize = 4
	inviteCodeRandLen  = 6
	inviteCodeDays     = 180
	inviteMaxMembers   = 1
)

// ErrMailNotConfigured —— owner 还没配 / 没 test 通 mail connector,发不出信。
var ErrMailNotConfigured = errors.New("mail connector not configured")

// MailStatusDeps —— 只读 mail connector 状态(给公共 gate 配置用)。#155：经品类槽
// (MailProxy.Connected = active mail 连接器连没连)，不再读旧 mail 连接器存储。
type MailStatusDeps struct {
	Proxy MailProxy
}

// OwnerCanEmailCodes —— owner 是否有 connected(test 通过)的 active mail connector。
// gate 用它决定要不要展示「request access」整块:发不出码就别让访客白填。
// 读失败按"不能发"处理(保守 + 不暴露错误到公共端点)。
func OwnerCanEmailCodes(ctx context.Context, deps MailStatusDeps, ownerID string) bool {
	if ownerID == "" {
		return false
	}
	ok, err := deps.Proxy.Connected(ctx, ownerID)
	if err != nil {
		return false
	}
	return ok
}

// ApproveRequestDeps —— approve 闭环依赖(跨 mail / requests / codes / roles / owners)。
// Proxy = 出站发信(连接器代调，凭据不出 vault)；Mail = 连接器状态读(Connected 预检)。
type ApproveRequestDeps struct {
	Reqs   *postgres.AccessRequestRepo
	Codes  *postgres.CodeRepo
	Roles  *postgres.RoleRepo
	Owners *postgres.OwnerRepo
	Proxy  MailProxy
}

// ApproveResult —— 发码闭环结果(回 admin UI 展示)。
type ApproveResult struct {
	Code string
	Link string
}

// ApproveAccessRequest —— 批准一条 gate 请求:issue AccessCode + 邮件发 requester
// (含码 + /<page>?code= 链接)+ 状态置 replied。mail connector 必须先 connected,
// 否则 ErrMailNotConfigured(发不出去就不发码,避免发了码没人知道)。
func ApproveAccessRequest(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (ApproveResult, error) {
	prep, err := prepareApproval(ctx, deps, ownerID, requestID)
	if err != nil {
		return ApproveResult{}, err
	}
	if serr := deps.Proxy.Send(ctx, ownerID, prep.msg); serr != nil {
		return ApproveResult{}, fmt.Errorf("send approval email: %w", serr)
	}
	if _, uerr := deps.Reqs.UpdateStatus(ctx, ownerID, requestID, "replied"); uerr != nil {
		return ApproveResult{}, fmt.Errorf("mark request replied: %w", uerr)
	}
	return ApproveResult{Code: prep.code, Link: prep.link}, nil
}

type approvalPrep struct {
	msg  MailMessage
	code string
	link string
}

func prepareApproval(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (approvalPrep, error) {
	c, err := loadApprovalContext(ctx, deps, ownerID, requestID)
	if err != nil {
		return approvalPrep{}, err
	}
	code, cerr := issueInviteCode(ctx, deps, ownerID)
	if cerr != nil {
		return approvalPrep{}, cerr
	}
	link := buildCodeLink(c.owner.PublicURL, code)
	return approvalPrep{
		code: code, link: link,
		msg: buildApprovalEmail(&c.req, code, link),
	}, nil
}

type approvalContext struct {
	req   domain.AccessRequest
	owner domain.Owner
}

func loadApprovalContext(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (approvalContext, error) {
	ok, err := deps.Proxy.Connected(ctx, ownerID)
	if err != nil {
		return approvalContext{}, fmt.Errorf("mail connector status: %w", err)
	}
	if !ok {
		return approvalContext{}, ErrMailNotConfigured
	}
	req, rerr := deps.Reqs.GetByID(ctx, ownerID, requestID)
	if rerr != nil {
		return approvalContext{}, fmt.Errorf("get access request: %w", rerr)
	}
	owner, oerr := deps.Owners.GetByID(ctx, ownerID)
	if oerr != nil {
		return approvalContext{}, fmt.Errorf("get owner: %w", oerr)
	}
	return approvalContext{req: req, owner: owner}, nil
}

func issueInviteCode(ctx context.Context, deps ApproveRequestDeps, ownerID string) (string, error) {
	public, verr := deps.Roles.GetByName(ctx, ownerID, domain.PublicRoleName)
	if verr != nil {
		return "", fmt.Errorf("get public role: %w", verr)
	}
	code, gerr := generateInviteCode()
	if gerr != nil {
		return "", gerr
	}
	expires := time.Now().AddDate(0, 0, inviteCodeDays)
	maxMembers := int32(inviteMaxMembers)
	if _, cerr := deps.Codes.CreateAccessCode(ctx, &domain.CreateAccessCodeInput{
		OwnerID: ownerID, Code: code, Label: "invite",
		Purpose: "access request approval", AssumedRoleID: public.ID(),
		ExpiresAt: &expires, MaxMembers: &maxMembers,
	}); cerr != nil {
		return "", fmt.Errorf("create access code: %w", cerr)
	}
	return code, nil
}

// generateInviteCode —— "inv-XXXXXX" lowercase base32(URL-safe,肉眼可读),
// 跟 application code 同范式。
func generateInviteCode() (string, error) {
	buf := make([]byte, inviteCodeRandSize)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	enc := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf)
	return inviteCodePrefix + "-" + strings.ToLower(enc)[:inviteCodeRandLen], nil
}

func buildCodeLink(publicURL, code string) string {
	return strings.TrimRight(publicURL, "/") + "?code=" + code
}

func buildApprovalEmail(req *domain.AccessRequest, code, link string) MailMessage {
	greeting := "Hi there,"
	if req.Name != "" {
		greeting = "Hi " + req.Name + ","
	}
	body := greeting + "\n\n" +
		"Your request for access has been approved. Here is your access code:\n\n" +
		"    " + code + "\n\n" +
		"Open this link to start the conversation (the code is already filled in):\n\n" +
		"    " + link + "\n\n" +
		"Sent via StandMeet."
	return MailMessage{
		To:      req.Email,
		Subject: "Your access request has been approved",
		Body:    body,
	}
}
