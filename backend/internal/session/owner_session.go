// owner_session.go —— owner login 后的 Redis-backed session。
//
// Session token：32 字节随机 base64url，前缀 `sms_`。
// Redis key：`session:{token}`，value 是 JSON-encoded ownerSessionData。
// TTL：24h slide（每次访问刷 expires_at + Redis TTL 同步刷）。
// 撤销：DEL key 即可。

package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	ownerTokenBytes    = 32
	ownerTokenPrefix   = "sms_"
	ownerSessionTTL    = 24 * time.Hour
	ownerSessionKeyPfx = "session:"
	csrfTokenBytes     = 32
)

// ErrSessionNotFound —— Redis 里没这个 session（已 expire 或 logout）。
var ErrSessionNotFound = errors.New("session not found")

// OwnerSessionData 是存在 Redis 里的 session payload。
// 字段顺序按 time.Time / string / string 对齐 fieldalignment。
type OwnerSessionData struct {
	ExpiresAt time.Time `json:"expires_at"`
	OwnerID   string    `json:"owner_id"`
	CSRFToken string    `json:"csrf_token"`
}

// IssuedSession 把 Issue 返回的 plaintext token + session data 打包，
// 让函数返回 ≤ 2 个值。
type IssuedSession struct {
	Token string
	Data  OwnerSessionData
}

// OwnerSessionStore wrap Redis client 提供 session CRUD。无业务逻辑。
type OwnerSessionStore struct {
	rdb *redis.Client
}

// NewOwnerSessionStore 构造 store。
func NewOwnerSessionStore(rdb *redis.Client) *OwnerSessionStore {
	return &OwnerSessionStore{rdb: rdb}
}

// Issue 颁发一个新 session。返回的 IssuedSession 含 plaintext token（caller
// 写 cookie）和 SessionData（含 csrf_token，给 GET /csrf 返回）。
func (s *OwnerSessionStore) Issue(ctx context.Context, ownerID string) (IssuedSession, error) {
	token, err := randomToken(ownerTokenBytes, ownerTokenPrefix)
	if err != nil {
		return IssuedSession{}, fmt.Errorf("gen session token: %w", err)
	}
	csrf, err := randomToken(csrfTokenBytes, "")
	if err != nil {
		return IssuedSession{}, fmt.Errorf("gen csrf token: %w", err)
	}

	data := OwnerSessionData{
		OwnerID:   ownerID,
		CSRFToken: csrf,
		ExpiresAt: time.Now().Add(ownerSessionTTL),
	}
	if perr := s.persist(ctx, token, data); perr != nil {
		return IssuedSession{}, perr
	}
	return IssuedSession{Token: token, Data: data}, nil
}

// Get 读 session；slide TTL（重置到 24h）。session 不存在返回 ErrSessionNotFound。
func (s *OwnerSessionStore) Get(ctx context.Context, token string) (OwnerSessionData, error) {
	raw, err := s.rdb.Get(ctx, ownerSessionKeyPfx+token).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return OwnerSessionData{}, ErrSessionNotFound
		}
		return OwnerSessionData{}, fmt.Errorf("redis get session: %w", err)
	}
	var data OwnerSessionData
	if uerr := json.Unmarshal(raw, &data); uerr != nil {
		return OwnerSessionData{}, fmt.Errorf("decode session: %w", uerr)
	}
	data.ExpiresAt = time.Now().Add(ownerSessionTTL)
	if perr := s.persist(ctx, token, data); perr != nil {
		return OwnerSessionData{}, perr
	}
	return data, nil
}

// Revoke 删 session（logout）。不存在的 token 当成功（idempotent）。
func (s *OwnerSessionStore) Revoke(ctx context.Context, token string) error {
	if err := s.rdb.Del(ctx, ownerSessionKeyPfx+token).Err(); err != nil {
		return fmt.Errorf("redis del session: %w", err)
	}
	return nil
}

func (s *OwnerSessionStore) persist(
	ctx context.Context, token string, data OwnerSessionData,
) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("encode session: %w", err)
	}
	key := ownerSessionKeyPfx + token
	if serr := s.rdb.Set(ctx, key, payload, ownerSessionTTL).Err(); serr != nil {
		return fmt.Errorf("redis set session: %w", serr)
	}
	return nil
}

func randomToken(byteLen int, prefix string) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buf), nil
}
