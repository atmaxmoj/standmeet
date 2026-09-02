// protocol_smtp.go — the protocol-kind SMTP connector: a generic protocol (any SMTP server)
// implementing the mail category contract (contract.MailProxy). Sits alongside the openapi
// adapter — both kinds land on the same contract, and the consumer (a mailer caller) has no
// idea whether it's an HTTP API or SMTP behind it.
//
// A protocol connector has no spec/binding: the implementation is built-in (net/smtp, reusing
// mailer), and configuration (host/port/credentials) comes decrypted from SMTPVault per
// (connector, owner). Credentials never leave this layer.

package connector

import (
	"context"
	"errors"
	"fmt"
	"net/textproto"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
)

// FriendlyVerifyError — maps a connection-test error to an owner-friendly reason (connect/tls/
// auth categories; the connector layer recognizes mailer's categorized sentinels); an
// unrecognized category → "". The consumer (connectorsvc) uses this to make a connect failure
// friendly.
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

// SMTPConfig — the decrypted configuration for an SMTP connector.
type SMTPConfig struct {
	Host        string
	Username    string
	Password    string
	FromAddress string
	FromName    string
	TLS         string // "" | "none" | "starttls" | "tls" (implicit)
	Port        int
}

// Configured — whether the minimum configuration to physically send mail is filled in (has a
// host).
func (c *SMTPConfig) Configured() bool { return c.Host != "" }

// toMailerConfig — decrypted config → Config (shared by Verify/Send, sparing copying fields at
// every call site).
func (c *SMTPConfig) toMailerConfig() *Config {
	return &Config{
		Host: c.Host, Port: c.Port, Username: c.Username, Password: c.Password,
		FromAddress: c.FromAddress, FromName: c.FromName, TLS: c.TLS,
	}
}

// SMTPVault — the connection source for a protocol(smtp) connector: connection state +
// decrypted config.
type SMTPVault interface {
	Connected(ctx context.Context, connectorID, ownerID string) (bool, error)
	SMTPConfig(ctx context.Context, connectorID, ownerID string) (SMTPConfig, error)
}

// smtpConnector — implements the Connector base surface + contract.MailProxy.
type smtpConnector struct {
	vault SMTPVault
	id    string
}

// NewSMTPConnector — assemble an SMTP protocol connector.
func NewSMTPConnector(id string, vault SMTPVault) Connector {
	return &smtpConnector{vault: vault, id: id}
}

// Name — Connector base surface.
func (c *smtpConnector) Name() string { return c.id }

// Kind — a protocol connector always reports kind=protocol (tells a consumer this runs over a
// built-in protocol, not an HTTP spec).
func (*smtpConnector) Kind() string { return "protocol" }

// Verify — Connector connection test: run one handshake with the owner's stored SMTP config (no
// message sent). Any of host/port/auth/TLS failing → error (mapped to a friendly "not
// connected" when admin connects). A protocol connector's connect = this test.
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

// Connected — whether the mail connector is usable (has credentials + verified), delegates to
// vault.
func (c *smtpConnector) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("connector %q connected: %w", c.id, err)
	}
	return ok, nil
}

// Send — send mail through the owner's SMTP connector; not configured → ErrMailNotConfigured.
// The floor for Send is "has credentials that can physically send" (Configured), not "already
// verified" (Connected) — the verification email itself gets sent before Connected is true.
// **The id in the receipt is empty** (F-C-55): the SMTP path has no message id the contract can
// promise — the 250 line sometimes carries a queue number, but that's each server's own
// dialect. Empty = this path can't give one, not that the send failed.
func (c *smtpConnector) Send(
	ctx context.Context, ownerID string, msg contract.MailMessage,
) (contract.MailReceipt, error) {
	cfg, err := c.vault.SMTPConfig(ctx, c.id, ownerID)
	if err != nil {
		return contract.MailReceipt{}, fmt.Errorf("connector %q smtp config: %w", c.id, err)
	}
	if !cfg.Configured() {
		return contract.MailReceipt{}, consumer.ErrMailNotConfigured
	}
	b := Compose(cfg.toMailerConfig()).To(msg.To).Subject(msg.Subject).Body(msg.Body)
	if msg.HTML != "" {
		b = b.HTML(msg.HTML)
	}
	if serr := b.Send(ctx); serr != nil {
		// The original error stays in the %w chain for logging — the contract surface only
		// reads the sentinel.
		return contract.MailReceipt{}, fmt.Errorf("%w: %w", smtpFailureClass(serr), serr)
	}
	return contract.MailReceipt{}, nil
}

// smtpFailureClass — sorts a failure into "permanent" or "temporary" by SMTP reply code.
//
// This used to classify everything as "temporarily unavailable", reasoning that "SMTP can't
// tell apart a temporarily-broken server from a rejected message". It can: the leading digit of
// the reply code is exactly that distinction — 5xx is a permanent rejection (invalid address /
// refused / too large), only 4xx means try again later. Collapsed into one class, the sentence
// "change the recipient" **can never come out** on the surface: the owner always gets "try
// again in a bit", and that class of failure won't improve no matter how many times they retry.
// A branch that can never occur is the same as never having written it.
//
// When no reply code is available (connection refused / network down / timeout) → temporary:
// that kind of failure has nothing to do with this message's content anyway.
func smtpFailureClass(err error) error {
	var reply *textproto.Error
	if errors.As(err, &reply) && reply.Code >= smtpPermanentFloor && reply.Code < smtpCodeCeiling {
		return contract.ErrMailRejected
	}
	return contract.ErrMailUnavailable
}

// The hundreds digit of an SMTP reply code is the permanent / temporary distinction: 5xx
// permanent, 4xx temporary.
const (
	smtpPermanentFloor = 500
	smtpCodeCeiling    = 600
)
