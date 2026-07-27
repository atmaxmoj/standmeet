// mail_otp.go —— 出站 SMTP connector 的「真 OTP」验证。老 test 只发探针信、SMTP
// 不报错就标 connected —— 不证明 owner 真控制收件箱。改成:SendMailOTP 真发一封
// 6 位码到 from_address;VerifyMailOTP 只有码对才标 connected,错满 MailOTPMaxAttempts
// 次即作废。码只存 sha256,明文只进邮件。发信走 OutboundSender(凭据不出 vault)。

package usecase

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// MailDeps —— mail connector OTP / 状态管理依赖。Proxy = 出站发信(连接器代调，
// SMTP 凭据不出 vault);Mail = OTP/connector 状态读写;Owners = 收件人(owner 邮箱)。
type MailDeps struct {
	Mail   *connector.MailRepo
	Owners *repo.Repo
	Proxy  OutboundSender
}

var (
	// ErrMailOTPNone —— 没有待验 OTP(没发过 / 已过期 / 已用)。
	ErrMailOTPNone = errors.New("mail otp: no active code")
	// ErrMailOTPTooMany —— 错误次数达上限,当前 OTP 作废,需重发。
	ErrMailOTPTooMany = errors.New("mail otp: too many attempts")
	// ErrMailOTPCooldown —— 距上次发码太近,拒绝(防 email bomb)。
	ErrMailOTPCooldown = errors.New("mail otp: resend cooldown")
)

// MailOTPMismatchError —— 码不对但还有剩余次数;带 Remaining 给 UI 提示「还有 N 次」。
type MailOTPMismatchError struct {
	Remaining int
}

func (e *MailOTPMismatchError) Error() string {
	return fmt.Sprintf("mail otp: code mismatch, %d attempts left", e.Remaining)
}

// SendMailOTP —— 生成 6 位 OTP,存其 sha256+过期,从 from_address 发到 owner 自己的
// 邮箱(验证 owner 控制该邮箱 + SMTP 真能发)。不标 connected。
func SendMailOTP(ctx context.Context, deps MailDeps, ownerID string) error {
	if _, err := loadConfiguredConnector(ctx, deps, ownerID); err != nil {
		return err
	}
	ownerRow, oerr := deps.Owners.GetByID(ctx, ownerID)
	if oerr != nil {
		return fmt.Errorf("get owner: %w", oerr)
	}
	code, gerr := connector.GenerateMailOTP()
	if gerr != nil {
		return fmt.Errorf("generate mail otp: %w", gerr)
	}
	if serr := deps.Mail.SetOTP(ctx, ownerID, connector.MailProvider, connector.HashMailOTP(code),
		time.Now().Add(connector.MailOTPTTL)); serr != nil {
		return fmt.Errorf("set mail otp: %w", serr)
	}
	return sendOTPEmail(ctx, deps, ownerID, ownerRow.Email, code)
}

// loadConfiguredConnector —— 取 connector 并确认已填凭据(没填 → ErrMailNotConfigured)
// + 冷却窗校验。返 conn 供 caller 读字段(发信走 proxy，不直接用 conn 凭据)。
func loadConfiguredConnector(
	ctx context.Context, deps MailDeps, ownerID string,
) (connector.MailConnector, error) {
	conn, err := deps.Mail.GetConnector(ctx, ownerID, connector.MailProvider)
	if err != nil {
		return conn, fmt.Errorf("get mail connector: %w", err)
	}
	if !conn.HasCredentials() {
		return conn, consumer.ErrMailNotConfigured
	}
	if conn.OTPIssuedRecently(time.Now(), connector.MailOTPResendCooldown) {
		return conn, ErrMailOTPCooldown
	}
	return conn, nil
}

// sendOTPEmail —— To = owner 邮箱;From = connector from_address(由 proxy 内置)。
// 发 HTML(StandMeet 风格)+ 纯文本兜底。
func sendOTPEmail(ctx context.Context, deps MailDeps, ownerID, toEmail, code string) error {
	mins := int(connector.MailOTPTTL.Minutes())
	if err := deps.Proxy.Send(ctx, ownerID, OutboundMessage{
		To:      toEmail,
		Subject: "StandMeet email verification code",
		Body: fmt.Sprintf("Your StandMeet verification code is %s\n\nEnter it under "+
			"admin → Connectors to verify outbound email. It expires in %d minutes.",
			code, mins),
		HTML: otpEmailHTML(code, mins),
	}); err != nil {
		return fmt.Errorf("send otp email: %w", err)
	}
	return nil
}

// VerifyMailOTP —— 校验 owner 输入的码。对 → MarkConnected(顺带清 OTP);错 → 计数
// +1,达上限作废;无/过期 → ErrMailOTPNone。
func VerifyMailOTP(ctx context.Context, deps MailDeps, ownerID, code string) error {
	conn, err := deps.Mail.GetConnector(ctx, ownerID, connector.MailProvider)
	if err != nil {
		return fmt.Errorf("get mail connector: %w", err)
	}
	if !conn.OTPActive(time.Now()) {
		return ErrMailOTPNone
	}
	if conn.OTPExhausted() {
		return voidOTP(ctx, deps, ownerID)
	}
	if conn.OTPMatches(code) {
		return acceptOTP(ctx, deps, ownerID)
	}
	return registerWrongOTP(ctx, deps, ownerID)
}

func acceptOTP(ctx context.Context, deps MailDeps, ownerID string) error {
	if merr := deps.Mail.MarkConnected(ctx, ownerID, connector.MailProvider); merr != nil {
		return fmt.Errorf("mark mail connected: %w", merr)
	}
	return nil
}

func registerWrongOTP(ctx context.Context, deps MailDeps, ownerID string) error {
	n, ierr := deps.Mail.IncOTPAttempts(ctx, ownerID, connector.MailProvider)
	if ierr != nil {
		return fmt.Errorf("inc mail otp attempts: %w", ierr)
	}
	if n >= connector.MailOTPMaxAttempts {
		return voidOTP(ctx, deps, ownerID)
	}
	return &MailOTPMismatchError{Remaining: connector.MailOTPMaxAttempts - n}
}

func voidOTP(ctx context.Context, deps MailDeps, ownerID string) error {
	if cerr := deps.Mail.ClearOTP(ctx, ownerID, connector.MailProvider); cerr != nil {
		return fmt.Errorf("clear mail otp: %w", cerr)
	}
	return ErrMailOTPTooMany
}
