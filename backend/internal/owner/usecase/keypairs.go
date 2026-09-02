// keypairs.go — Phase C: Owner keypair create / list / delete + Sigv1 header signature
// verification. Every MCP HTTP request carries `Authorization: Sigv1 keyId=X,ts=N,
// sig=base64`; this usecase parses the header -> looks up the public key ->
// ed25519.Verify. No session cookie / no token minting / no nonce table — replay is
// defended against with a ts window instead.

package usecase

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// challengeNS — the Sigv1 challenge namespace, kept in sync with e2e/fixtures/sigv1.ts.
const challengeNS = "standmeet-sigv1"

// sigv1MaxSkew — the allowed clock-skew window (+/-5min).
const sigv1MaxSkew = 5 * time.Minute

// KeypairDeps — what the keypair use cases need.
type KeypairDeps struct {
	Repo  *repo.KeypairRepo
	Log   *slog.Logger
	Nonce NonceStore
}

// NonceStore — a one-time nonce record (defends against Sigv1 replay). Implemented in
// the composition root (Redis SetNX).
type NonceStore interface {
	// Fresh — the first time this key is seen, returns (true,nil) and records it (expires
	// after TTL); already seen returns (false,nil) = a replay.
	Fresh(ctx context.Context, key string, ttl time.Duration) (bool, error)
}

// CreateKeypairInputReq — input for admin POST /api/admin/keypairs.
type CreateKeypairInputReq struct {
	OwnerID string
	Label   string
}

// CreatedKeypair — Create's result (includes PrivateKeyPEM, **returned only once, at
// creation time**).
type CreatedKeypair struct {
	Record        entity.Keypair
	PrivateKeyPEM string
}

// CreateKeypair — the server generates an Ed25519 keypair, persists the public key, and
// returns the private key PEM to the owner exactly once.
func CreateKeypair(
	ctx context.Context, deps KeypairDeps, in *CreateKeypairInputReq,
) (CreatedKeypair, error) {
	if in.OwnerID == "" || in.Label == "" {
		return CreatedKeypair{}, apierr.ErrEmptyField
	}
	pems, gerr := generateKeypairPEMs()
	if gerr != nil {
		return CreatedKeypair{}, gerr
	}
	rec, err := deps.Repo.Create(ctx, &repo.CreateKeypairInput{
		OwnerID: in.OwnerID, KeyID: uuid.NewString(),
		PublicKeyPEM: pems.PublicPEM, Label: in.Label,
	})
	if err != nil {
		return CreatedKeypair{}, fmt.Errorf("persist keypair: %w", err)
	}
	return CreatedKeypair{Record: rec, PrivateKeyPEM: pems.PrivatePEM}, nil
}

// keypairPEMs — bundles encodeKeypairPEM's return values; avoids the 3-return lint.
type keypairPEMs struct {
	PublicPEM  string
	PrivatePEM string
}

func generateKeypairPEMs() (keypairPEMs, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return keypairPEMs{}, fmt.Errorf("generate ed25519: %w", err)
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return keypairPEMs{}, fmt.Errorf("marshal public key: %w", err)
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return keypairPEMs{}, fmt.Errorf("marshal private key: %w", err)
	}
	return keypairPEMs{
		PublicPEM:  string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER})),
		PrivatePEM: string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER})),
	}, nil
}

// ListKeypairs — used by admin GET /api/admin/keypairs, metadata only.
func ListKeypairs(
	ctx context.Context, deps KeypairDeps, ownerID string,
) ([]entity.KeypairMetadata, error) {
	if ownerID == "" {
		return nil, apierr.ErrEmptyField
	}
	out, err := deps.Repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list keypairs: %w", err)
	}
	return out, nil
}

// DeleteKeypair — a hard delete = revoke. First GetByKeyID checks existence + owner
// match; a mismatch returns ErrKeypairUnauthorized so existence isn't leaked.
func DeleteKeypair(
	ctx context.Context, deps KeypairDeps, ownerID, keyID string,
) error {
	if ownerID == "" || keyID == "" {
		return apierr.ErrEmptyField
	}
	if oerr := ensureKeypairOwned(ctx, deps, ownerID, keyID); oerr != nil {
		return oerr
	}
	if derr := deps.Repo.Delete(ctx, ownerID, keyID); derr != nil {
		return fmt.Errorf("delete keypair: %w", derr)
	}
	return nil
}

// ensureKeypairOwned — if GetByKeyID returns ErrKeypairUnauthorized, pass it straight
// through; an owner mismatch returns the same sentinel too (existence isn't leaked);
// any other error is wrapped.
func ensureKeypairOwned(
	ctx context.Context, deps KeypairDeps, ownerID, keyID string,
) error {
	kp, err := deps.Repo.GetByKeyID(ctx, keyID)
	if err != nil {
		if errors.Is(err, entity.ErrKeypairUnauthorized) {
			return entity.ErrKeypairUnauthorized
		}
		return fmt.Errorf("get keypair: %w", err)
	}
	if kp.OwnerID != ownerID {
		return entity.ErrKeypairUnauthorized
	}
	return nil
}

// VerifySigv1 — parses the `Sigv1 keyId=X,ts=N,sig=base64` header, and on a successful
// signature check returns owner_id; any single step failing returns
// ErrKeypairUnauthorized.
//
// Steps:
//  1. Parse header fields
//  2. ts is within the +/-5min window (clock skew)
//  3. DB lookup of the public key (a miss = 401)
//  4. ed25519.Verify(pub, challenge, sig) — challenge =
//     "standmeet-sigv1\n<keyId>\n<ts>\n<nonce>"
//  5. First-seen nonce check (Redis, defends against replay within the window; fail-open)
//  6. Touch last_used_at (best effort, log only on failure)
//
// Returns (ownerID, nil) on success; (empty, ErrKeypairUnauthorized) if any step fails.
func VerifySigv1(
	ctx context.Context, deps KeypairDeps, authHeader string,
) (string, error) {
	parsed, perr := parseSigv1Header(authHeader)
	if perr != nil {
		return "", entity.ErrKeypairUnauthorized
	}
	if !withinSkew(parsed.ts) {
		return "", entity.ErrKeypairUnauthorized
	}
	return verifyParsedSig(ctx, deps, parsed)
}

type parsedSigv1 struct {
	keyID string
	nonce string
	sig   []byte
	ts    int64
}

func parseSigv1Header(h string) (parsedSigv1, error) {
	const prefix = "Sigv1 "
	if !strings.HasPrefix(h, prefix) {
		return parsedSigv1{}, errors.New("missing Sigv1 prefix")
	}
	rest := strings.TrimPrefix(h, prefix)
	fields, err := splitSigv1Fields(rest)
	if err != nil {
		return parsedSigv1{}, err
	}
	return buildParsedSigv1(fields)
}

func splitSigv1Fields(rest string) (map[string]string, error) {
	parts := strings.Split(rest, ",")
	out := make(map[string]string, len(parts))
	for _, p := range parts {
		eq := strings.IndexByte(p, '=')
		if eq <= 0 {
			return nil, errors.New("malformed Sigv1 field")
		}
		key := strings.TrimSpace(p[:eq])
		val := strings.TrimSpace(p[eq+1:])
		if key == "" || val == "" {
			return nil, errors.New("empty Sigv1 field")
		}
		out[key] = val
	}
	return out, nil
}

func buildParsedSigv1(fields map[string]string) (parsedSigv1, error) {
	raw, ferr := requireSigv1Fields(fields)
	if ferr != nil {
		return parsedSigv1{}, ferr
	}
	var ts int64
	if _, perr := fmt.Sscanf(raw.ts, "%d", &ts); perr != nil {
		return parsedSigv1{}, fmt.Errorf("parse ts: %w", perr)
	}
	sig, derr := base64.StdEncoding.DecodeString(raw.sig)
	if derr != nil {
		return parsedSigv1{}, fmt.Errorf("decode sig: %w", derr)
	}
	return parsedSigv1{keyID: raw.keyID, ts: ts, sig: sig, nonce: raw.nonce}, nil
}

// rawSigv1Fields — the string quadruple after presence-checking the fields.
type rawSigv1Fields struct {
	keyID, ts, sig, nonce string
}

func requireSigv1Fields(fields map[string]string) (rawSigv1Fields, error) {
	out := rawSigv1Fields{
		keyID: fields["keyId"], ts: fields["ts"], sig: fields["sig"], nonce: fields["nonce"],
	}
	if out.keyID == "" || out.ts == "" || out.sig == "" || out.nonce == "" {
		return rawSigv1Fields{}, errors.New("missing required Sigv1 field")
	}
	return out, nil
}

func withinSkew(ts int64) bool {
	nowSec := time.Now().Unix()
	diff := nowSec - ts
	if diff < 0 {
		diff = -diff
	}
	return diff <= int64(sigv1MaxSkew.Seconds())
}

func verifyParsedSig(
	ctx context.Context, deps KeypairDeps, p parsedSigv1,
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
	challenge := fmt.Sprintf("%s\n%s\n%d\n%s", challengeNS, p.keyID, p.ts, p.nonce)
	if !ed25519.Verify(pub, []byte(challenge), p.sig) {
		return "", entity.ErrKeypairUnauthorized
	}
	if rerr := checkNonceFresh(ctx, deps, p); rerr != nil {
		return "", rerr
	}
	deps.Repo.Touch(ctx, deps.Log, kp.ID)
	return kp.OwnerID, nil
}

// nonceTTL — how long a nonce record stays alive: covers both sides of the +/-skew
// acceptance window plus margin; after that it can be reused (ts has long since expired).
const nonceTTL = 2 * sigv1MaxSkew

// checkNonceFresh — after signature verification passes, confirms the nonce is being
// seen for the first time (defends against replay). Fail-open: if the nonce store isn't
// wired up or Redis errors, allow the request (degrade to plain ts-window) — a Redis
// blip must not block the owner's MCP auth.
func checkNonceFresh(ctx context.Context, deps KeypairDeps, p parsedSigv1) error {
	if deps.Nonce == nil {
		return nil
	}
	fresh, err := deps.Nonce.Fresh(ctx, "sigv1nonce:"+p.keyID+":"+p.nonce, nonceTTL)
	if err != nil {
		deps.Log.Warn("sigv1 nonce store error; allowing (degrade to ts-window)", "err", err)
		return nil
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
