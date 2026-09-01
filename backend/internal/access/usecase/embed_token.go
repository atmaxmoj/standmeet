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

// NonceStore —— 一次性 jti 记录（防重放）。实现 = Redis SetNX（跟 Sigv1 共用同一个）。
type NonceStore interface {
	Fresh(ctx context.Context, key string, ttl time.Duration) (bool, error)
}

// EmbedTokenDeps —— 验 embed JWT 所需。
type EmbedTokenDeps struct {
	Embeds *repo.EmbedRepo
	Nonce  NonceStore
	Log    *slog.Logger
}

// embedTokenNonceTTL —— jti 记录存活时间：盖过 JWT 的有效窗再留余量，之后 exp 早已过期可回收。
const embedTokenNonceTTL = 10 * time.Minute

// embedClaims —— origin 折进签名；其余走标准注册声明（iss/iat/exp/jti）。
type embedClaims struct {
	jwt.RegisteredClaims

	Origin string `json:"origin"`
}

// VerifyEmbedToken —— 验 widget 的 EdDSA JWT，通过则返它暴露的 code。
//
// 顺序（任一步失败给一句 sentinel，不细分 → 不给探测预言机）：
//  1. 解析 + **硬钉 alg=EdDSA**（WithValidMethods）——挡 alg:none / 算法混淆；exp/iat 由库校、exp 必填。
//  2. keyFunc 按 kid 取这个 embed 的公钥（未知 kid → 失败）。
//  3. origin claim == 浏览器带的 Origin 头（页面 JS 伪造不了它）。
//  4. origin 在这个 embed 的白名单里，否则 ErrEmbedOriginNotAllowed（403）。
//  5. jti 首见（Redis，**fail-closed**：空 / 未装 / Redis 出错 → 拒；公开面不留静默重放窗口）。
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

// parsedEmbedToken —— 解析验签的产出：反查到的 auth + 校过的 claims。
type parsedEmbedToken struct {
	claims *embedClaims
	auth   entity.EmbedAuth
}

// parseEmbedToken —— 解析 + 验签（**alg=EdDSA 硬钉**、exp 必填），keyFunc 按 kid 取公钥。
func parseEmbedToken(
	ctx context.Context, deps EmbedTokenDeps, tokenStr string,
) (parsedEmbedToken, error) {
	var auth entity.EmbedAuth
	// jwt.Keyfunc 的签名要求返回 (any, error)——库边界，不是业务代码在选 any。
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

// checkEmbedOrigin —— 签的 origin 必须等于浏览器带的 Origin 头，且在白名单里。
func checkEmbedOrigin(auth *entity.EmbedAuth, claimOrigin, headerOrigin string) error {
	if claimOrigin == "" || claimOrigin != headerOrigin {
		return entity.ErrEmbedTokenInvalid
	}
	if !auth.OriginAllowed(claimOrigin) {
		return entity.ErrEmbedOriginNotAllowed
	}
	return nil
}

// embedNonceFresh —— jti 首见校验。**fail-closed**（跟 Sigv1 的 fail-open 相反）。
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
