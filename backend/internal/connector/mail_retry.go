// mail_retry.go — a "retrying send" proxy dedicated to owner-notify (D-6 R6). Wraps a
// MailProxy, retrying **transient transport errors** (connection dropped/refused/timeout/EOF)
// in the background per notifyPolicy; permanent errors like ErrMailNotConfigured are not
// retried. Only owner-notify goes through this layer — a confirmation email is a synchronous
// single send that reports an error inline on the card on failure, and is **never retried**.
// The retry base is only allowed for use by connector (architecture), so retrying lives here,
// not in usecases/cmd.

package connector

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"

	"github.com/atmaxmoj/standmeet/internal/connector/consumer"
	"github.com/atmaxmoj/standmeet/internal/connector/contract"
	"github.com/atmaxmoj/standmeet/internal/infra/retry"
)

// RetryingMailProxy — wraps a contract.MailProxy; Send retries transient transport errors per
// notifyPolicy.
type RetryingMailProxy struct {
	inner contract.MailProxy
}

// NewRetryingMailProxy — composition root injects the underlying MailProxy (used by
// owner-notify).
func NewRetryingMailProxy(inner contract.MailProxy) *RetryingMailProxy {
	return &RetryingMailProxy{inner: inner}
}

// Connected — a read; passed through without retry.
func (p *RetryingMailProxy) Connected(ctx context.Context, ownerID string) (bool, error) {
	ok, err := p.inner.Connected(ctx, ownerID)
	if err != nil {
		return false, fmt.Errorf("mail connected: %w", err)
	}
	return ok, nil
}

// Send — retries transient transport errors within budget; a connection error that never
// reached the far side is safe to resend (owner-notify isn't idempotency-sensitive).
func (p *RetryingMailProxy) Send(
	ctx context.Context, ownerID string, msg contract.MailMessage,
) (contract.MailReceipt, error) {
	var rcpt contract.MailReceipt
	if err := retry.Do(ctx, notifyPolicy(), func() error {
		var serr error
		rcpt, serr = p.inner.Send(ctx, ownerID, msg)
		if serr != nil {
			return fmt.Errorf("mail proxy send: %w", serr)
		}
		return nil
	}); err != nil {
		return contract.MailReceipt{}, fmt.Errorf("owner notify send: %w", err)
	}
	return rcpt, nil
}

// mailTransient — retries only transient transport errors (connection
// dropped/refused/timeout/EOF); permanent errors like ErrMailNotConfigured are not retried.
func mailTransient(err error) bool {
	if err == nil || errors.Is(err, consumer.ErrMailNotConfigured) {
		return false
	}
	var ne net.Error
	if errors.As(err, &ne) {
		return true
	}
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}
