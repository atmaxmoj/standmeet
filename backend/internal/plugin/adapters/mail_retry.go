// mail_retry.go — the one table that says whether a mail send failure is worth trying again.
//
// Retry has one owner — the job layer (internal/infra/jobs). This file does not retry; it only
// classifies. The mail side-effect port (internal/infra/sideeffect/mail) turns "not transient" into
// a discarded job; the supplier.invoke job (internal/infra/sideeffect/supplier) reads the same
// table through SupplierPermanent.

package adapters

import (
	"errors"
	"io"
	"net"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// MailTransient — a send that failed for now, not for good: the provider was unreachable,
// dropped the connection, timed out or answered "try later". Everything else — no supplier, a
// rejected message (a 5xx reply: change the recipient), a revoked grant — would only fail again.
//
// A block-backed supplier reports its class as a fault code, and Dispatcher.Invoke wraps every
// failure in an outer fault of its own, so the whole chain is read: an inner "rejected" wins over
// the outer "unavailable".
func MailTransient(err error) bool {
	if err == nil || mailPermanent(err) {
		return false
	}
	return hasFault(err, hostop.FaultUnavailable) || errors.Is(err, ErrMailUnavailable) ||
		transientTransport(err)
}

// mailPermanent — failures no retry can fix.
func mailPermanent(err error) bool {
	return errors.Is(err, ErrMailNotConfigured) || errors.Is(err, ErrNoSupplier) ||
		errors.Is(err, ErrMailRejected) ||
		hasFault(err, hostop.FaultRejected, hostop.FaultRevoked, hostop.FaultNotConfigured)
}

// SupplierPermanent — a supplier call (any seam) failed for good: the mail table's permanent
// failures, plus a calendar that is not connected, revoked, or refused the request. The
// supplier.invoke job discards on these instead of retrying.
func SupplierPermanent(err error) bool {
	return mailPermanent(err) || errors.Is(err, ErrCalendarNotConnected) ||
		errors.Is(err, ErrCalendarRevoked) || errors.Is(err, ErrCalendarBadRequest) ||
		errors.Is(err, ErrCalendarBlockedEgress)
}

// hasFault — whether any fault in err's chain carries one of codes.
func hasFault(err error, codes ...string) bool {
	for e := err; e != nil; e = errors.Unwrap(e) {
		var fe *hostop.FaultError
		if !errors.As(e, &fe) {
			return false
		}
		if slices.Contains(codes, fe.Code) {
			return true
		}
		e = fe
	}
	return false
}

// transientTransport — the non-fault transient signal: a net.Error (dropped/refused/timeout) or an
// EOF, for the in-host (non-block) mail paths.
func transientTransport(err error) bool {
	if ne, ok := errors.AsType[net.Error](err); ok && ne != nil {
		return true
	}
	return errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF)
}
