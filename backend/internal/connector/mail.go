// mail.go —— Phase B：SMTP 邮件 proxy，实现 usecases.MailProxy。句柄
// (ownerID) → load mail 连接器 + 解密 SMTP 凭据 + 经 net/smtp 发出。SMTP
// 用户名/密码只在本包内存活，不进 usecases。

package connector

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/mailer"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

// MailVault —— mail 连接器凭据存取（repo 边界解密 → 明文 connector）。
type MailVault interface {
	GetConnector(ctx context.Context, ownerID, provider string) (domain.MailConnector, error)
}

// MailProxy —— 实现 usecases.MailProxy。
type MailProxy struct {
	vault MailVault
}

// NewMailProxy —— composition root 注入 mail vault。
func NewMailProxy(vault MailVault) *MailProxy {
	return &MailProxy{vault: vault}
}

// Connected —— mail 连接器是否可用（有凭据 + OTP 已验）。
func (p *MailProxy) Connected(ctx context.Context, ownerID string) (bool, error) {
	conn, err := p.vault.GetConnector(ctx, ownerID, domain.MailProvider)
	if err != nil {
		return false, fmt.Errorf("load mail connector: %w", err)
	}
	return conn.Connected(), nil
}

// Send —— 用 owner SMTP 连接器发信；未配/未连 → ErrMailNotConfigured。
func (p *MailProxy) Send(ctx context.Context, ownerID string, msg usecases.MailMessage) error {
	conn, err := p.vault.GetConnector(ctx, ownerID, domain.MailProvider)
	if err != nil {
		return fmt.Errorf("load mail connector: %w", err)
	}
	// Send 的下限是「有凭据能物理发出」(HasCredentials)，不是「已验证可用」
	// (Connected)。OTP 验证信本身就在 Connected 之前发 —— 验证后才 Connected。
	// 「只对已验证连接器发应用邮件」的门留在各 caller（approval 检 Connected）。
	if !conn.HasCredentials() {
		return usecases.ErrMailNotConfigured
	}
	b := mailer.Compose(&mailer.Config{
		Host: conn.Host, Port: conn.Port,
		Username: conn.Username, Password: conn.Password,
		FromAddress: conn.FromAddress, FromName: conn.FromName,
	}).To(msg.To).Subject(msg.Subject).Body(msg.Body)
	if msg.HTML != "" {
		b = b.HTML(msg.HTML)
	}
	if serr := b.Send(); serr != nil {
		return fmt.Errorf("send mail: %w", serr)
	}
	return nil
}
