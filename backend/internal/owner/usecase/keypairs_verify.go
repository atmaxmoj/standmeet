// keypairs_verify.go — the second half of Sigv1 verification: the stored public key, the signature
// over the (possibly request-bound) challenge, and the one-time nonce. Parsing and the skew window
// are in keypairs.go.

package usecase

import (
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/owner/entity"
)

func verifyParsedSig(
	ctx context.Context, deps KeypairDeps, p *parsedSigv1, req *SignedRequest,
) (string, error) {
	kp, err := deps.Repo.GetByKeyID(ctx, p.keyID)
	if err != nil {
		return "", entity.ErrKeypairUnauthorized
	}
	pub, perr := decodePublicKey(kp.PublicKeyPEM)
	if perr != nil {
		deps.Log.Error("keypair: decode stored public key", "err", perr, "key_id", p.keyID)
		return "", entity.ErrKeypairUnauthorized
	}
	if !ed25519.Verify(pub, []byte(challengeFor(p, req)), p.sig) {
		return "", entity.ErrKeypairUnauthorized
	}
	if rerr := checkNonceFresh(ctx, deps, p); rerr != nil {
		return "", rerr
	}
	warnUnbound(deps.Log, p, kp.Label)
	deps.Repo.Touch(ctx, deps.Log, kp.ID, req.ClientIP, req.UserAgent)
	return kp.OwnerID, nil
}

// warnUnbound —— a client still signing the unbound form: say which key, so the owner can update it
// (`update_self`) before the unbound form is refused.
func warnUnbound(log *slog.Logger, p *parsedSigv1, label string) {
	if p.version != "2" {
		log.Warn("sigv1: unbound signature (client predates request binding; update it)",
			"key_id", p.keyID, "label", label)
	}
}

// nonceTTL — how long a nonce record stays alive: covers both sides of the +/-skew
// acceptance window plus margin; after that it can be reused (ts has long since expired).
const nonceTTL = 2 * sigv1MaxSkew

// checkNonceFresh — after signature verification passes, confirms the nonce is being
// seen for the first time (defends against replay). Fail-closed: when the nonce store errors
// the request is refused (refactor ledger R6). It used to be allowed — "a Redis blip must not
// block the owner's MCP auth" — which turned every Redis hiccup into a window where a captured
// header replays against the full-power endpoint. The embed-token path already fails closed on
// the same store. No store wired (unit tests) still skips the check.
func checkNonceFresh(ctx context.Context, deps KeypairDeps, p *parsedSigv1) error {
	if deps.Nonce == nil {
		return nil
	}
	fresh, err := deps.Nonce.Fresh(ctx, "sigv1nonce:"+p.keyID+":"+p.nonce, nonceTTL)
	if err != nil {
		deps.Log.Error("sigv1 nonce store error; refusing (replay cannot be ruled out)", "err", err)
		return entity.ErrKeypairUnauthorized
	}
	if !fresh {
		return entity.ErrKeypairUnauthorized
	}
	return nil
}

func decodePublicKey(pemStr string) (ed25519.PublicKey, error) {
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		return nil, errors.New("decode PEM: no block found")
	}
	pub, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse PKIX: %w", err)
	}
	edPub, ok := pub.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("not an ed25519 public key")
	}
	return edPub, nil
}
