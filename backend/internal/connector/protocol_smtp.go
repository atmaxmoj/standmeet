// protocol_smtp.go —— protocol kind 的 SMTP 连接器：通用协议（任意 SMTP server）实现 mail
// 品类契约（contract.MailProxy）。跟 openapi 适配器并列——两 kind 都到同一个契约，消费者
// （mailer 调用方）一概不知背后是 HTTP API 还是 SMTP。
//
// protocol 连接器没有 spec/binding：实现是内置的（net/smtp，复用 mailer），配置（host/port/
// 凭据）由 SMTPVault 按 (连接器,owner) 解密给出。凭据永不出本层。

package connector

import (
	"context"
	"errors"
	"fmt"
	"net/textproto"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
)

// FriendlyVerifyError —— 把连接测试错误映成 owner 友好理由（connect/tls/auth 分类，连接器层认得
// mailer 的分类 sentinel）；非已知分类 → ""。消费者（connectorsvc）经此把 connect 失败友好化。
func FriendlyVerifyError(err error) string {
	switch {
	case errors.Is(err, ErrVerifyAuth):
		return ErrVerifyAuth.Error()
	case errors.Is(err, ErrVerifyTLS):
		return ErrVerifyTLS.Error()
	case errors.Is(err, ErrVerifyConnect):
		return ErrVerifyConnect.Error()
	default:
		return ""
	}
}

// SMTPConfig —— 一个 SMTP 连接器的解密后配置。
type SMTPConfig struct {
	Host        string
	Username    string
	Password    string
	FromAddress string
	FromName    string
	TLS         string // "" | "none" | "starttls" | "tls"（implicit）
	Port        int
}

// Configured —— 是否填了能物理发信的最低配置（有 host）。
func (c *SMTPConfig) Configured() bool { return c.Host != "" }

// toMailerConfig —— 解密后配置 → Config（Verify/Send 共用，免去逐处抄字段）。
func (c *SMTPConfig) toMailerConfig() *Config {
	return &Config{
		Host: c.Host, Port: c.Port, Username: c.Username, Password: c.Password,
		FromAddress: c.FromAddress, FromName: c.FromName, TLS: c.TLS,
	}
}

// SMTPVault —— protocol(smtp) 连接器的连接源：连接状态 + 解密后配置。
type SMTPVault interface {
	Connected(ctx context.Context, connectorID, ownerID string) (bool, error)
	SMTPConfig(ctx context.Context, connectorID, ownerID string) (SMTPConfig, error)
}

// smtpConnector —— 实现 Connector 基面 + contract.MailProxy。
type smtpConnector struct {
	vault SMTPVault
	id    string
}

// NewSMTPConnector —— 装配一个 SMTP protocol 连接器。
func NewSMTPConnector(id string, vault SMTPVault) Connector {
	return &smtpConnector{vault: vault, id: id}
}

// Name —— Connector 基面。
func (c *smtpConnector) Name() string { return c.id }

// Kind —— protocol 连接器固定 kind=protocol（消费者经此知道底下走内置协议而非 HTTP spec）。
func (*smtpConnector) Kind() string { return "protocol" }

// Verify —— Connector 连接测试：用 owner 存的 SMTP 配置跑一次握手（不发信）。host/port/auth/TLS
// 任一错 → 错（admin connect 时映射成友好「未连接」）。protocol 连接器的 connect = 这个测试。
func (c *smtpConnector) Verify(ctx context.Context, ownerID string) error {
	cfg, err := c.vault.SMTPConfig(ctx, c.id, ownerID)
	if err != nil {
		return fmt.Errorf("connector %q smtp config: %w", c.id, err)
	}
	if !cfg.Configured() {
		return consumer.ErrMailNotConfigured
	}
	if verr := Verify(ctx, cfg.toMailerConfig()); verr != nil {
		return fmt.Errorf("connector %q smtp verify: %w", c.id, verr)
	}
	return nil
}

// Connected —— mail 连接器是否可用（有凭据 + 已验证），委托 vault。
func (c *smtpConnector) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q connected: %w", c.id, err)
	}
	return ok, nil
}

// Send —— 用 owner SMTP 连接器发信；未配 → ErrMailNotConfigured。Send 的下限是「有凭据能
// 物理发出」(Configured)，不是「已验证」(Connected)——验证信本身就在 Connected 之前发。
func (c *smtpConnector) Send(ctx context.Context, ownerID string, msg contract.MailMessage) error {
	cfg, err := c.vault.SMTPConfig(ctx, c.id, ownerID)
	if err != nil {
		return fmt.Errorf("connector %q smtp config: %w", c.id, err)
	}
	if !cfg.Configured() {
		return consumer.ErrMailNotConfigured
	}
	b := Compose(cfg.toMailerConfig()).To(msg.To).Subject(msg.Subject).Body(msg.Body)
	if msg.HTML != "" {
		b = b.HTML(msg.HTML)
	}
	if serr := b.Send(); serr != nil {
		// 原始错误留在 %w 链里给日志 —— 面那一侧只读哨兵。
		return fmt.Errorf("%w: %w", smtpFailureClass(serr), serr)
	}
	return nil
}

// smtpFailureClass —— 按 SMTP 回码把失败分成「永久」和「暂时」。
//
// 这里以前一律归成「暂时不可用」,理由写的是"SMTP 分不出服务器暂时不行和这封被拒"。分得出:
// 回码的第一位就是这件事 —— 5xx 是永久拒绝(地址不合法 / 被拒收 / 超大),4xx 才是稍后再试。
// 塌成一类之后,面上那句"改收件人"**永远出不来**:owner 拿到的永远是"过一会儿再试",而这一类
// 他再试一百次也不会好。一个从来不可能出现的分支跟没写是一回事。
//
// 拿不到回码(连接被拒 / 网络断 / 超时)→ 暂时:那种失败本来就跟这一封的内容无关。
func smtpFailureClass(err error) error {
	var reply *textproto.Error
	if errors.As(err, &reply) && reply.Code >= smtpPermanentFloor && reply.Code < smtpCodeCeiling {
		return contract.ErrMailRejected
	}
	return contract.ErrMailUnavailable
}

// SMTP 回码的百位就是永久 / 暂时之分:5xx 永久,4xx 暂时。
const (
	smtpPermanentFloor = 500
	smtpCodeCeiling    = 600
)
