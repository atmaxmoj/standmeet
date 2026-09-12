// protocol_smtp.go — the protocol-kind SMTP supplier: a generic protocol (any SMTP server)
// implementing the mail seam contract (MailProxy). Sits alongside the openapi
// adapter — both kinds land on the same contract, and the consumer (a mailer caller) has no
// idea whether it's an HTTP API or SMTP behind it.
//
// A protocol supplier has no spec/binding: the implementation is built-in (net/smtp, reusing
// mailer), and configuration (host/port/credentials) comes decrypted from SMTPVault per
// (block, owner). Credentials never leave this layer.

package adapters

import (
	"context"
	"errors"
	"fmt"
	"net/textproto"

	"github.com/atmaxmoj/standmeet/internal/infra/mailer"
)

// FriendlyVerifyError — maps a connection-test error to an owner-friendly reason (connect/tls/
// auth classes; this layer recognizes mailer's classified sentinels); an
// unrecognized class → "". The consumer (the admin service) uses this to make a connect failure
// friendly.
func FriendlyVerifyError(err error) string {
	switch {
	case errors.Is(err, mailer.ErrVerifyAuth):
		return mailer.ErrVerifyAuth.Error()
	case errors.Is(err, mailer.ErrVerifyTLS):
		return mailer.ErrVerifyTLS.Error()
	case errors.Is(err, mailer.ErrVerifyConnect):
		return mailer.ErrVerifyConnect.Error()
	default:
		return ""
	}
}

// SMTPConfig — the decrypted configuration for an SMTP supplier.
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
func (c *SMTPConfig) toMailerConfig() *mailer.Config {
	return &mailer.Config{
		Host: c.Host, Port: c.Port, Username: c.Username, Password: c.Password,
		FromAddress: c.FromAddress, FromName: c.FromName, TLS: c.TLS,
	}
}

// SMTPVault — the connection source for a protocol(smtp) supplier: connection state +
// decrypted config.
type SMTPVault interface {
	Connected(ctx context.Context, blockID, ownerID string) (bool, error)
	SMTPConfig(ctx context.Context, blockID, ownerID string) (SMTPConfig, error)
}

// smtpSupplier — implements the Supplier base surface + MailProxy.
type smtpSupplier struct {
	vault SMTPVault
	id    string
}

// NewSMTPSupplier — assemble an SMTP protocol supplier.
func NewSMTPSupplier(id string, vault SMTPVault) Supplier {
	return &smtpSupplier{vault: vault, id: id}
}

// Name — Supplier base surface.
func (c *smtpSupplier) Name() string { return c.id }

// Kind — a protocol supplier always reports kind=protocol (tells a consumer this runs over a
// built-in protocol, not an HTTP spec).
func (*smtpSupplier) Kind() string { return "protocol" }

// Verify — Supplier connection test: run one handshake with the owner's stored SMTP config (no
// message sent). Any of host/port/auth/TLS failing → error (mapped to a friendly "not
// connected" when admin connects). A protocol supplier's connect = this test.
func (c *smtpSupplier) Verify(ctx context.Context, ownerID string) error {
	cfg, err := c.vault.SMTPConfig(ctx, c.id, ownerID)
	if err != nil {
		return fmt.Errorf("supplier %q smtp config: %w", c.id, err)
	}
	if !cfg.Configured() {
		return ErrMailNotConfigured
	}
	if verr := mailer.Verify(ctx, cfg.toMailerConfig()); verr != nil {
		return fmt.Errorf("supplier %q smtp verify: %w", c.id, verr)
	}
	return nil
}

// Connected — whether the mail supplier is usable (has credentials + verified), delegates to
// vault.
func (c *smtpSupplier) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := c.vault.Connected(ctx, c.id, ownerID)
	if err != nil {
		return false, fmt.Errorf("supplier %q connected: %w", c.id, err)
	}
	return ok, nil
}

// Send — send mail through the owner's SMTP supplier; not configured → ErrMailNotConfigured.
// The floor for Send is "has credentials that can physically send" (Configured), not "already
// verified" (Connected) — the verification email itself gets sent before Connected is true.
// **The id in the receipt is empty** (F-C-55): the SMTP path has no message id the contract can
// promise — the 250 line sometimes carries a queue number, but that's each server's own
// dialect. Empty = this path can't give one, not that the send failed.
func (c *smtpSupplier) Send(
	ctx context.Context, ownerID string, msg MailMessage,
) (MailReceipt, error) {
	cfg, err := c.vault.SMTPConfig(ctx, c.id, ownerID)
	if err != nil {
		return MailReceipt{}, fmt.Errorf("supplier %q smtp config: %w", c.id, err)
	}
	if !cfg.Configured() {
		return MailReceipt{}, ErrMailNotConfigured
	}
	b := mailer.Compose(cfg.toMailerConfig()).To(msg.To).Subject(msg.Subject).Body(msg.Body)
	if msg.HTML != "" {
		b = b.HTML(msg.HTML)
	}
	if serr := b.Send(ctx); serr != nil {
		// The original error stays in the %w chain for logging — the contract surface only
		// reads the sentinel.
		return MailReceipt{}, fmt.Errorf("%w: %w", smtpFailureClass(serr), serr)
	}
	return MailReceipt{}, nil
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
		return ErrMailRejected
	}
	return ErrMailUnavailable
}

// The hundreds digit of an SMTP reply code is the permanent / temporary distinction: 5xx
// permanent, 4xx temporary.
const (
	smtpPermanentFloor = 500
	smtpCodeCeiling    = 600
)
