// access_approval.go —— 批准一条 gate 访问请求:发一张 AccessCode,并把它**送到**申请人手上。
//
// 发码是核心的事(AccessCode 是产品自己的东西);**怎么送出去不是**。送走这一步只经
// `OutboundSender` —— 一个收件人、一句标题、一段正文。这个包因此不知道对面是邮件、是 IM、
// 还是别的什么,也不知道 owner 配的是哪个连接器。

package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"strings"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

const (
	inviteCodePrefix   = "inv"
	inviteCodeRandSize = 4
	inviteCodeRandLen  = 6
	inviteCodeDays     = 180
	inviteMaxMembers   = 1
)

// 送不出去时用 ErrOutboundNotConfigured(见 outbound.go) —— 内核自己的哨兵。

// OutboundStatusDeps —— 只读出站通道的可用性(给公共 gate 配置用)。
type OutboundStatusDeps struct {
	Proxy OutboundSender
}

// CanDeliverCodes —— owner 有没有一条可用的出站通道,能把发出的码送到申请人手上。
// gate 用它决定要不要展示「request access」整块:送不出去就别让访客白填。
// 读失败按"送不了"处理(保守 + 不暴露错误到公共端点)。
func CanDeliverCodes(ctx context.Context, deps OutboundStatusDeps, ownerID string) bool {
	if ownerID == "" {
		return false
	}
	ok, err := deps.Proxy.Connected(ctx, ownerID)
	if err != nil {
		return false
	}
	return ok
}

// ApproveRequestDeps —— approve 闭环依赖(跨 requests / codes / roles / owners + 出站口)。
// Proxy 一个口管两件事:预检"送不送得出去"(Connected),和真正把通知送走(Send)。
type ApproveRequestDeps struct {
	Reqs   *access.RequestRepo
	Codes  *access.CodeRepo
	Roles  *access.RoleRepo
	Owners *repo.Repo
	Proxy  OutboundSender
}

// ApproveResult —— 发码闭环结果(回 admin UI 展示)。
type ApproveResult struct {
	Code string
	Link string
}

// ApproveAccessRequest —— 批准一条 gate 请求:issue AccessCode + 把它送给申请人
// (含码 + /<page>?code= 链接)+ 状态置 replied。出站通道必须先可用,否则
// ErrOutboundNotConfigured(送不出去就不发码,避免发了码没人知道)。
func ApproveAccessRequest(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (ApproveResult, error) {
	prep, err := prepareApproval(ctx, deps, ownerID, requestID)
	if err != nil {
		return ApproveResult{}, err
	}
	if serr := deps.Proxy.Send(ctx, ownerID, prep.msg); serr != nil {
		return ApproveResult{}, fmt.Errorf("send approval notice: %w", serr)
	}
	if _, uerr := deps.Reqs.UpdateStatus(ctx, ownerID, requestID, "replied"); uerr != nil {
		return ApproveResult{}, fmt.Errorf("mark request replied: %w", uerr)
	}
	return ApproveResult{Code: prep.code, Link: prep.link}, nil
}

type approvalPrep struct {
	msg  OutboundNotice
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
		msg: buildApprovalNotice(&c.req, code, link),
	}, nil
}

type approvalContext struct {
	req   access.Request
	owner entity.Owner
}

func loadApprovalContext(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (approvalContext, error) {
	ok, err := deps.Proxy.Connected(ctx, ownerID)
	if err != nil {
		return approvalContext{}, fmt.Errorf("outbound channel status: %w", err)
	}
	if !ok {
		return approvalContext{}, ErrOutboundNotConfigured
	}
	req, rerr := deps.Reqs.GetByID(ctx, ownerID, requestID)
	if rerr != nil {
		return approvalContext{}, fmt.Errorf("get access request: %w", rerr)
	}
	ownerRow, oerr := deps.Owners.GetByID(ctx, ownerID)
	if oerr != nil {
		return approvalContext{}, fmt.Errorf("get owner: %w", oerr)
	}
	return approvalContext{req: req, owner: ownerRow}, nil
}

func issueInviteCode(ctx context.Context, deps ApproveRequestDeps, ownerID string) (string, error) {
	public, verr := deps.Roles.GetByName(ctx, ownerID, access.PublicRoleName)
	if verr != nil {
		return "", fmt.Errorf("get public role: %w", verr)
	}
	code, gerr := generateInviteCode()
	if gerr != nil {
		return "", gerr
	}
	expires := time.Now().AddDate(0, 0, inviteCodeDays)
	maxMembers := int32(inviteMaxMembers)
	if _, cerr := deps.Codes.CreateAccessCode(ctx, &access.CreateAccessCodeInput{
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

// buildApprovalNotice —— 通知的**内容**是产品自己的(是 StandMeet 在告诉申请人他拿到了码),
// 所以它属于内核。属于渠道的是"怎么送",那一步在 OutboundSender 后面。
func buildApprovalNotice(req *access.Request, code, link string) OutboundNotice {
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
	return OutboundNotice{
		To:    req.Email,
		Title: "Your access request has been approved",
		Body:  body,
	}
}
