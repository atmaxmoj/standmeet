// mail_retry.go — a "retrying send" proxy dedicated to owner-notify (D-6 R6). Wraps a
// MailProxy, retrying **transient transport errors** (connection dropped/refused/timeout/EOF)
// in the background per notifyPolicy; permanent errors like ErrMailNotConfigured are not
// retried. Only owner-notify goes through this layer — a confirmation email is a synchronous
// single send that reports an error inline on the card on failure, and is **never retried**.
// The retry base is only allowed for use by the supplier layer (architecture), so retrying
// lives here, not in usecases/cmd.

package adapters

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
	"github.com/atmaxmoj/standmeet/internal/infra/retry"
)

// RetryingMailProxy — wraps a MailProxy; Send retries transient transport errors per
// notifyPolicy.
type RetryingMailProxy struct {
	inner MailProxy
}

// NewRetryingMailProxy — composition root injects the underlying MailProxy (used by
// owner-notify).
func NewRetryingMailProxy(inner MailProxy) *RetryingMailProxy {
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
	ctx context.Context, ownerID string, msg MailMessage,
) (MailReceipt, error) {
	var rcpt MailReceipt
	if err := retry.Do(ctx, notifyPolicy(), func() error {
		var serr error
		rcpt, serr = p.inner.Send(ctx, ownerID, msg)
		if serr != nil {
			return fmt.Errorf("mail proxy send: %w", serr)
		}
		return nil
	}); err != nil {
		return MailReceipt{}, fmt.Errorf("owner notify send: %w", err)
	}
	return rcpt, nil
}

// mailTransient — retries only transient transport errors (connection
// dropped/refused/timeout/EOF); permanent errors like ErrMailNotConfigured are not retried.
//
// A block-backed mail supplier reports every send failure as an "unavailable" fault
// (hostop.FaultUnavailable — configured, but couldn't send right now: unreachable / rejected /
// timed out). The block boundary flattens the underlying net.Error to one sentence, so the
// net.Error branch (transientTransport) can't see it — the fault code is how transient-ness crosses
// the socket, and owner-notify must retry it (R6: a transient owner-notify send recovers in time).
func mailTransient(err error) bool {
	if err == nil || errors.Is(err, ErrMailNotConfigured) {
		return false
	}
	var fe *hostop.FaultError
	if errors.As(err, &fe) {
		return fe.Code == hostop.FaultUnavailable
	}
	return transientTransport(err)
}

// transientTransport — the non-fault transient signal: a net.Error (dropped/refused/timeout) or an
// EOF. Used by mailTransient for the in-host (non-block) mail paths.
func transientTransport(err error) bool {
	var ne net.Error
	if errors.As(err, &ne) {
		return true
	}
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}
