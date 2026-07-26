// keypairs.go —— Phase C: Owner keypair create / list / delete + Sigv1
// header 验签。每个 MCP HTTP 请求带 `Authorization: Sigv1 keyId=X,ts=N,
// sig=base64`；本 usecase 解 header → 查公钥 → ed25519.Verify。无 session
// cookie / 无 token mint / 无 nonce 表，依靠 ts 窗口防 replay。

package usecases

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

	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
	"github.com/atmaxmoj/standmeet/internal/postgres"
)

// challengeNS —— Sigv1 challenge 命名空间，跟 e2e/fixtures/sigv1.ts 对齐。
const challengeNS = "standmeet-sigv1"

// sigv1MaxSkew —— 允许的时钟偏差窗口 (±5min)。
const sigv1MaxSkew = 5 * time.Minute

// KeypairDeps —— keypair 用例所需。
type KeypairDeps struct {
	Repo  *postgres.OwnerKeypairRepo
	Log   *slog.Logger
	Nonce NonceStore
}

// NonceStore —— 一次性 nonce 记录（防 Sigv1 重放）。实现在 composition root（Redis SetNX）。
type NonceStore interface {
	// Fresh —— 首次见此 key 返 (true,nil) 并记下（TTL 后过期）；已见返 (false,nil) = 重放。
	Fresh(ctx context.Context, key string, ttl time.Duration) (bool, error)
}

// CreateKeypairInput —— admin POST /api/admin/keypairs 入参。
type CreateKeypairInput struct {
	OwnerID string
	Label   string
}

// CreatedKeypair —— Create 返结果 (含 PrivateKeyPEM，**只在创建时返回一次**)。
type CreatedKeypair struct {
	Record        ownerdomain.OwnerKeypair
	PrivateKeyPEM string
}

// CreateKeypair —— 服务端生成 Ed25519 keypair，落库存公钥，返私钥 PEM 给
// owner 一次。
func CreateKeypair(
	ctx context.Context, deps KeypairDeps, in *CreateKeypairInput,
) (CreatedKeypair, error) {
	if in.OwnerID == "" || in.Label == "" {
		return CreatedKeypair{}, ErrEmptyField
	}
	pems, gerr := generateKeypairPEMs()
	if gerr != nil {
		return CreatedKeypair{}, gerr
	}
	rec, err := deps.Repo.Create(ctx, &postgres.CreateKeypairInput{
		OwnerID: in.OwnerID, KeyID: uuid.NewString(),
		PublicKeyPEM: pems.PublicPEM, Label: in.Label,
	})
	if err != nil {
		return CreatedKeypair{}, fmt.Errorf("persist keypair: %w", err)
	}
	return CreatedKeypair{Record: rec, PrivateKeyPEM: pems.PrivatePEM}, nil
}

// keypairPEMs —— encodeKeypairPEM 返打包；避开 3-return lint。
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

// ListKeypairs —— admin GET /api/admin/keypairs 用，metadata only。
func ListKeypairs(
	ctx context.Context, deps KeypairDeps, ownerID string,
) ([]ownerdomain.OwnerKeypairMetadata, error) {
	if ownerID == "" {
		return nil, ErrEmptyField
	}
	out, err := deps.Repo.ListByOwner(ctx, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list keypairs: %w", err)
	}
	return out, nil
}

// DeleteKeypair —— hard delete = revoke。先 GetByKeyID 验存在 + owner 匹配，
// 不匹配返 ErrKeypairUnauthorized 不泄露存在性。
func DeleteKeypair(
	ctx context.Context, deps KeypairDeps, ownerID, keyID string,
) error {
	if ownerID == "" || keyID == "" {
		return ErrEmptyField
	}
	if oerr := ensureKeypairOwned(ctx, deps, ownerID, keyID); oerr != nil {
		return oerr
	}
	if derr := deps.Repo.Delete(ctx, ownerID, keyID); derr != nil {
		return fmt.Errorf("delete keypair: %w", derr)
	}
	return nil
}

// ensureKeypairOwned —— GetByKeyID 返 ErrKeypairUnauthorized 直接透传；
// owner 不匹也返同 sentinel (不泄露存在性)；其他错 wrap。
func ensureKeypairOwned(
	ctx context.Context, deps KeypairDeps, ownerID, keyID string,
) error {
	kp, err := deps.Repo.GetByKeyID(ctx, keyID)
	if err != nil {
		if errors.Is(err, ownerdomain.ErrKeypairUnauthorized) {
			return ownerdomain.ErrKeypairUnauthorized
		}
		return fmt.Errorf("get keypair: %w", err)
	}
	if kp.OwnerID != ownerID {
		return ownerdomain.ErrKeypairUnauthorized
	}
	return nil
}

// VerifySigv1 —— 解 `Sigv1 keyId=X,ts=N,sig=base64` 头，验签通过返
// owner_id；任一步失败返 ErrKeypairUnauthorized。
//
// 步骤：
//  1. 解 header 字段
//  2. ts 在 ±5min 窗口内 (clock skew)
//  3. DB 查公钥 (不命中 = 401)
//  4. ed25519.Verify(pub, challenge, sig) — challenge =
//     "standmeet-sigv1\n<keyId>\n<ts>\n<nonce>"
//  5. nonce 首见校验（Redis，防窗口内重放；fail-open）
//  6. Touch last_used_at (best effort, log only on fail)
//
// 返回 (ownerID, nil) on success；(empty, ErrKeypairUnauthorized) on 任一失败。
func VerifySigv1(
	ctx context.Context, deps KeypairDeps, authHeader string,
) (string, error) {
	parsed, perr := parseSigv1Header(authHeader)
	if perr != nil {
		return "", ownerdomain.ErrKeypairUnauthorized
	}
	if !withinSkew(parsed.ts) {
		return "", ownerdomain.ErrKeypairUnauthorized
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

// rawSigv1Fields —— 字段存在性校验后的 string 四元组。
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
		return "", ownerdomain.ErrKeypairUnauthorized
	}
	pub, perr := decodePublicKey(kp.PublicKeyPEM)
	if perr != nil {
		deps.Log.Error("keypair: decode stored public key", "err", perr, "key_id", p.keyID)
		return "", ownerdomain.ErrKeypairUnauthorized
	}
	challenge := fmt.Sprintf("%s\n%s\n%d\n%s", challengeNS, p.keyID, p.ts, p.nonce)
	if !ed25519.Verify(pub, []byte(challenge), p.sig) {
		return "", ownerdomain.ErrKeypairUnauthorized
	}
	if rerr := checkNonceFresh(ctx, deps, p); rerr != nil {
		return "", rerr
	}
	deps.Repo.Touch(ctx, deps.Log, kp.ID)
	return kp.OwnerID, nil
}

// nonceTTL —— nonce 记录存活时间：覆盖 ±skew 接受窗口两侧再留余量，之后可复用（ts 早已过期）。
const nonceTTL = 2 * sigv1MaxSkew

// checkNonceFresh —— 验签通过后确认 nonce 首次出现（防重放）。fail-open：nonce store 未装配
// 或 Redis 出错 → 放行（退回纯 ts-window），不因 Redis 抖动阻断 owner 的 MCP auth。
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
		return ownerdomain.ErrKeypairUnauthorized
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
