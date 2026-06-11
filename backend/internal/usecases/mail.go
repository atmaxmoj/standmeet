// mail.go —— 出站 mail connector 的业务逻辑:test send(验凭据 + 标 connected)
// 和 approve 闭环(批准 gate 请求 → issue AccessCode → 邮件发 requester)。
//
// 发信走 internal/mailer(std net/smtp,owner 自带 SMTP)。approve 复用 codes /
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
	"github.com/atmaxmoj/standmeet/internal/mailer"
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

// MailStatusDeps —— 只读 mail connector 状态(给公共 gate 配置用)。
type MailStatusDeps struct {
	Mail *postgres.MailRepo
}

// OwnerCanEmailCodes —— owner 是否有 connected(test 通过)的 mail connector。
// gate 用它决定要不要展示「request access」整块:发不出码就别让访客白填。
// 读失败按"不能发"处理(保守 + 不暴露错误到公共端点)。
func OwnerCanEmailCodes(ctx context.Context, deps MailStatusDeps, ownerID string) bool {
	if ownerID == "" {
		return false
	}
	conn, err := deps.Mail.GetConnector(ctx, ownerID, domain.MailProvider)
	if err != nil {
		return false
	}
	return conn.Connected()
}

// MailDeps —— mail connector test send 依赖。
type MailDeps struct {
	Mail   *postgres.MailRepo
	Owners *postgres.OwnerRepo
}

// TestMailConnector —— 给 owner 自己发一封测试信验凭据;成功则标 connected。
func TestMailConnector(ctx context.Context, deps MailDeps, ownerID string) error {
	tgt, err := loadTestTarget(ctx, deps, ownerID)
	if err != nil {
		return err
	}
	if serr := sendTestProbe(&tgt.conn, tgt.owner.Email); serr != nil {
		return serr
	}
	if merr := deps.Mail.MarkConnected(ctx, ownerID, domain.MailProvider); merr != nil {
		return fmt.Errorf("mark mail connected: %w", merr)
	}
	return nil
}

type testTarget struct {
	owner domain.Owner
	conn  domain.MailConnector
}

func loadTestTarget(ctx context.Context, deps MailDeps, ownerID string) (testTarget, error) {
	conn, err := deps.Mail.GetConnector(ctx, ownerID, domain.MailProvider)
	if err != nil {
		return testTarget{}, fmt.Errorf("get mail connector: %w", err)
	}
	if !conn.HasCredentials() {
		return testTarget{}, ErrMailNotConfigured
	}
	owner, oerr := deps.Owners.GetByID(ctx, ownerID)
	if oerr != nil {
		return testTarget{}, fmt.Errorf("get owner: %w", oerr)
	}
	return testTarget{owner: owner, conn: conn}, nil
}

func sendTestProbe(conn *domain.MailConnector, toEmail string) error {
	cfg := connectorConfig(conn)
	msg := mailer.Message{
		ToAddress: toEmail,
		Subject:   "StandMeet mail connector test",
		Body:      "This is a test email from StandMeet. Your outbound mail connector is working.",
	}
	if err := mailer.Send(&cfg, &msg, time.Now()); err != nil {
		return fmt.Errorf("send test email: %w", err)
	}
	return nil
}

// ApproveRequestDeps —— approve 闭环依赖(跨 mail / requests / codes / roles / owners)。
type ApproveRequestDeps struct {
	Reqs   *postgres.AccessRequestRepo
	Codes  *postgres.CodeRepo
	Roles  *postgres.RoleRepo
	Owners *postgres.OwnerRepo
	Mail   *postgres.MailRepo
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
	cfg := connectorConfig(&prep.conn)
	if serr := mailer.Send(&cfg, &prep.msg, time.Now()); serr != nil {
		return ApproveResult{}, fmt.Errorf("send approval email: %w", serr)
	}
	if _, uerr := deps.Reqs.UpdateStatus(ctx, ownerID, requestID, "replied"); uerr != nil {
		return ApproveResult{}, fmt.Errorf("mark request replied: %w", uerr)
	}
	return ApproveResult{Code: prep.code, Link: prep.link}, nil
}

type approvalPrep struct {
	msg  mailer.Message
	code string
	link string
	conn domain.MailConnector
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
		conn: c.conn, code: code, link: link,
		msg: buildApprovalEmail(&c.req, code, link),
	}, nil
}

type approvalContext struct {
	req   domain.AccessRequest
	owner domain.Owner
	conn  domain.MailConnector
}

func loadApprovalContext(
	ctx context.Context, deps ApproveRequestDeps, ownerID, requestID string,
) (approvalContext, error) {
	conn, err := deps.Mail.GetConnector(ctx, ownerID, domain.MailProvider)
	if err != nil {
		return approvalContext{}, fmt.Errorf("get mail connector: %w", err)
	}
	if !conn.Connected() {
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
	return approvalContext{conn: conn, req: req, owner: owner}, nil
}

func issueInviteCode(ctx context.Context, deps ApproveRequestDeps, ownerID string) (string, error) {
	vanilla, verr := deps.Roles.GetByName(ctx, ownerID, domain.VanillaRoleName)
	if verr != nil {
		return "", fmt.Errorf("get vanilla role: %w", verr)
	}
	code, gerr := generateInviteCode()
	if gerr != nil {
		return "", gerr
	}
	expires := time.Now().AddDate(0, 0, inviteCodeDays)
	maxMembers := int32(inviteMaxMembers)
	if _, cerr := deps.Codes.CreateAccessCode(ctx, &domain.CreateAccessCodeInput{
		OwnerID: ownerID, Code: code, Label: "invite",
		Purpose: "access request approval", AssumedRoleID: vanilla.ID(),
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

func connectorConfig(c *domain.MailConnector) mailer.Config {
	return mailer.Config{
		Host: c.Host, Port: c.Port,
		Username: c.Username, Password: c.Password,
		FromAddress: c.FromAddress, FromName: c.FromName,
	}
}

func buildApprovalEmail(req *domain.AccessRequest, code, link string) mailer.Message {
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
	return mailer.Message{
		ToAddress: req.Email,
		ToName:    req.Name,
		Subject:   "Your access request has been approved",
		Body:      body,
	}
}
