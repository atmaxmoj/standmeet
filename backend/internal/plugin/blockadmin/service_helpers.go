// service_helpers.go —— small standalone predicates + message helpers for the supplier admin
// service, split out of service.go to keep that file within the per-file line budget.

package blockadmin

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/plugin/credentials"
)

// specLessKind — kinds that legitimately carry no openapi spec: a credential-only supplier (a token
// holder, e.g. telegram) and a block supplier (a seam served by an MCP block, e.g. the CalDAV or
// SMTP block). They declare their seam directly and connect with no OAuth dance (a block connects
// via its Verify tool); only openapi parses a spec.
func specLessKind(kind string) bool {
	return kind == "credential" || kind == "block"
}

// verifyReason — a human next step for a failed connection test (falls back to a plain sentence).
//
// A block-backed supplier OWNS its error classification: the block's `verify` tool returns a
// friendly, classified sentence (the SMTP block's auth/tls/connect wording), which crosses the
// boundary as a fault carrying that sentence. Surface it verbatim — the host stays blind to the
// classification, and the owner still sees "TLS handshake failed…" rather than a generic sentence.
// A fault is recognized by method, not type (fault.go), so blockadmin needn't import hostop.
func verifyReason(err error) string {
	// The fault's own sentence, not err.Error(): that carries the wrapping chain
	// ("verify block \"discord\": …") in front of the words meant for the owner.
	var fault interface {
		FaultCode() string
		Error() string
	}
	if errors.As(err, &fault) && fault.Error() != "" {
		return fault.Error()
	}
	return "the connection test failed — check the host, port, and credentials"
}

// hasActive — whether any of the owner's connections for a seam is the active one.
func hasActive(conns []credentials.Connection) bool {
	for i := range conns {
		if conns[i].Active {
			return true
		}
	}
	return false
}

// verify —— the supplier's connection check, if it has one.
func (s *Service) verify(ctx context.Context, ownerID, id string) error {
	if s.d.Verifier == nil {
		return nil
	}
	return s.d.Verifier.VerifySupplier(ctx, id, ownerID)
}

// failedCheck —— a supplier that was connected and now fails its check is not connected any more:
// stored, not only shown (sijie 2026-10-01: the card said "not connected", a reload said
// "connected", and the im-bridge kept being handed a token Discord refused).
func (s *Service) failedCheck(
	ctx context.Context, ownerID, id string, verr error,
) (ConnectResult, error) {
	conn, err := s.d.Repo.Get(ctx, ownerID, id) // no row reads as not connected
	if err != nil {
		return ConnectResult{}, fmt.Errorf("read supplier after a failed check: %w", err)
	}
	if conn.Connected {
		if derr := s.Disconnect(ctx, ownerID, id); derr != nil {
			return ConnectResult{}, derr
		}
	}
	return ConnectResult{Connected: false, Error: verifyReason(verr)}, nil
}
