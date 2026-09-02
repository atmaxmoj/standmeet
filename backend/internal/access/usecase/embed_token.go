// embed_token.go —— verify the per-embed EdDSA JWT the <standmeet-chat> widget presents.
//
// The widget holds a per-embed Ed25519 private key (NOT the code). Each session issue signs a
// short-lived JWT folding in a bound origin + expiry + one-time jti. We verify with the embed's
// stored public key and resolve it to the code SERVER-SIDE — the plaintext code never leaves the
// server. Design: wiki/.../key-designs/embed-credential-never-carries-the-code.
//
// Reuses the same Redis one-time nonce store as owner Sigv1, but fail-CLOSED here (public surface).

package usecase

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/infra/cryptobox"
)

// NonceStore — records a one-time jti (replay protection). Impl = Redis SetNX (shares
// the same store as Sigv1).
type NonceStore interface {
	Fresh(ctx context.Context, key string, ttl time.Duration) (bool, error)
}

// EmbedTokenDeps — what's needed to verify the embed JWT.
type EmbedTokenDeps struct {
	Embeds *repo.EmbedRepo
	Nonce  NonceStore
	Log    *slog.Logger
}

// embedTokenNonceTTL — how long the jti record lives: covers the JWT's valid window
// plus slack; after that exp has long since passed and it can be reclaimed.
const embedTokenNonceTTL = 10 * time.Minute

// embedClaims — origin is folded into the signature; the rest uses standard
// registered claims (iss/iat/exp/jti).
type embedClaims struct {
	jwt.RegisteredClaims

	Origin string `json:"origin"`
}

// VerifyEmbedToken — verifies the widget's EdDSA JWT; on success returns the code it
// carries.
//
// Order (any step's failure returns one sentinel, no finer breakdown → no probing
// oracle):
//  1. Parse + **hard-pin alg=EdDSA** (WithValidMethods) — blocks alg:none / algorithm
//     confusion; exp/iat are checked by the library, exp is required.
//  2. keyFunc fetches this embed's public key by kid (unknown kid → failure).
//  3. origin claim == the browser's Origin header (page JS can't forge this).
//  4. origin is on this embed's allowlist, else ErrEmbedOriginNotAllowed (403).
//  5. jti first-seen check (Redis, **fail-closed**: empty / not installed / Redis
//     error → deny; the public surface leaves no silent replay window).
func VerifyEmbedToken(
	ctx context.Context, deps EmbedTokenDeps, tokenStr, originHeader string,
) (string, error) {
	p, err := parseEmbedToken(ctx, deps, tokenStr)
	if err != nil {
		return "", entity.ErrEmbedTokenInvalid
	}
	if oerr := checkEmbedOrigin(&p.auth, p.claims.Origin, originHeader); oerr != nil {
		return "", oerr
	}
	if nerr := embedNonceFresh(ctx, deps, p.claims.ID); nerr != nil {
		return "", nerr
	}
	return p.auth.Code, nil
}

// parsedEmbedToken — the output of parse+verify: the auth looked up along the way,
// plus the checked claims.
type parsedEmbedToken struct {
	claims *embedClaims
	auth   entity.EmbedAuth
}

// parseEmbedToken — parse + verify signature (**alg=EdDSA hard-pinned**, exp required);
// keyFunc fetches the public key by kid.
func parseEmbedToken(
	ctx context.Context, deps EmbedTokenDeps, tokenStr string,
) (parsedEmbedToken, error) {
	var auth entity.EmbedAuth
	// jwt.Keyfunc's signature requires returning (any, error) — a library
	// boundary, not business code choosing any.
	keyFunc := func(t *jwt.Token) (any, error) { //nolint:forbidigo // jwt.Keyfunc boundary
		a, err := deps.Embeds.AuthByKeyID(ctx, headerKID(t))
		if err != nil {
			return nil, fmt.Errorf("embed key lookup: %w", err)
		}
		auth = a
		return cryptobox.ParseEd25519Public(a.PublicKey)
	}
	claims := &embedClaims{}
	tok, perr := jwt.ParseWithClaims(tokenStr, claims, keyFunc,
		jwt.WithValidMethods([]string{"EdDSA"}), jwt.WithExpirationRequired())
	if perr != nil || !tok.Valid {
		return parsedEmbedToken{}, entity.ErrEmbedTokenInvalid
	}
	return parsedEmbedToken{auth: auth, claims: claims}, nil
}

func headerKID(t *jwt.Token) string {
	kid, ok := t.Header["kid"].(string)
	if !ok {
		return ""
	}
	return kid
}

// checkEmbedOrigin — the signed origin must equal the browser's Origin header, and be
// on the allowlist.
func checkEmbedOrigin(auth *entity.EmbedAuth, claimOrigin, headerOrigin string) error {
	if claimOrigin == "" || claimOrigin != headerOrigin {
		return entity.ErrEmbedTokenInvalid
	}
	if !auth.OriginAllowed(claimOrigin) {
		return entity.ErrEmbedOriginNotAllowed
	}
	return nil
}

// embedNonceFresh — first-seen check for jti. **fail-closed** (the opposite of
// Sigv1's fail-open).
func embedNonceFresh(ctx context.Context, deps EmbedTokenDeps, jti string) error {
	if jti == "" || deps.Nonce == nil {
		return entity.ErrEmbedTokenInvalid
	}
	fresh, err := deps.Nonce.Fresh(ctx, "embedjti:"+jti, embedTokenNonceTTL)
	if err != nil {
		warnNonce(deps.Log, err)
		return entity.ErrEmbedTokenInvalid
	}
	if !fresh {
		return entity.ErrEmbedTokenInvalid
	}
	return nil
}

func warnNonce(log *slog.Logger, err error) {
	if log != nil {
		log.Warn("embed jti nonce store error; refusing (fail-closed)", "err", err)
	}
}
