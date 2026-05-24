// visitor_session.go —— 访客 session（code-tier 或 byoai）的 Redis 存储。
//
// Token：32 字节随机 base64url，前缀 `smv_`。
// Redis key：`vsession:{token}`，value 是 JSON-encoded visitorSessionData。
// TTL：60min 滑动，max 8h（简化版只滑 60min，max 后续再加）。
// 撤销：DEL key。

package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/wangsijie/standmeet/internal/domain"
)

const (
	visitorTokenBytes    = 32
	visitorTokenPrefix   = "smv_"
	visitorSessionTTL    = 60 * time.Minute
	visitorSessionKeyPfx = "vsession:"
)

// ErrVisitorSessionNotFound —— Redis 里没这个 session（已 expire 或 revoke）。
var ErrVisitorSessionNotFound = errors.New("visitor session not found")

// VisitorSessionData —— Redis 里存的 visitor session payload。
//
// 准入字段：
//   - CorpusPermissions: 从 access code（或 byoai default）继承的 path-glob ACL
//   - BYOAIKeyEnc: visitor 自带 API key 的 AES-256-GCM 密文 (cryptobox)；
//     仅 byoai tier 有值，inference resolver 调 cryptobox.Decrypt 拿明文。
//     不直接存 plaintext —— Redis dump / 攻击者拿到 dump 也读不出。
//     usecase 层（visitor_public.IssuePublicSession）负责 encrypt；resolver
//     层（inference.EnvOrOwnerResolver）负责 decrypt。session 自身不接触
//     plaintext，只搬密文 bytes 进出 Redis。
type VisitorSessionData struct {
	ExpiresAt         time.Time               `json:"expires_at"`
	OwnerID           string                  `json:"owner_id"`
	Tier              string                  `json:"tier"`
	CodeID            string                  `json:"code_id"`
	MemberID          string                  `json:"member_id"`
	VisitorName       string                  `json:"visitor_name"`
	BYOAIProvider     string                  `json:"byoai_provider"`
	BYOAIKeyEnc       []byte                  `json:"byoai_key_enc,omitempty"`
	CorpusPermissions []domain.PathPermission `json:"corpus_permissions"`
}

// VisitorSessionStore wrap Redis 提供 visitor session CRUD。
type VisitorSessionStore struct {
	rdb *redis.Client
}

// NewVisitorSessionStore 构造 store。
func NewVisitorSessionStore(rdb *redis.Client) *VisitorSessionStore {
	return &VisitorSessionStore{rdb: rdb}
}

// IssuedVisitor —— Issue 返回（plaintext token + data）。
type IssuedVisitor struct {
	Token string
	Data  VisitorSessionData
}

// Issue 颁发新 visitor session。
func (s *VisitorSessionStore) Issue(
	ctx context.Context, data *VisitorSessionData,
) (IssuedVisitor, error) {
	token, err := randomToken(visitorTokenBytes, visitorTokenPrefix)
	if err != nil {
		return IssuedVisitor{}, fmt.Errorf("gen visitor token: %w", err)
	}
	data.ExpiresAt = time.Now().Add(visitorSessionTTL)
	if perr := s.persist(ctx, token, data); perr != nil {
		return IssuedVisitor{}, perr
	}
	return IssuedVisitor{Token: token, Data: *data}, nil
}

// Get 读 + 滑动 TTL；不存在返 ErrVisitorSessionNotFound。
func (s *VisitorSessionStore) Get(ctx context.Context, token string) (VisitorSessionData, error) {
	raw, err := s.rdb.Get(ctx, visitorSessionKeyPfx+token).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return VisitorSessionData{}, ErrVisitorSessionNotFound
		}
		return VisitorSessionData{}, fmt.Errorf("redis get visitor session: %w", err)
	}
	var data VisitorSessionData
	if uerr := json.Unmarshal(raw, &data); uerr != nil {
		return VisitorSessionData{}, fmt.Errorf("decode visitor session: %w", uerr)
	}
	data.ExpiresAt = time.Now().Add(visitorSessionTTL)
	if perr := s.persist(ctx, token, &data); perr != nil {
		return VisitorSessionData{}, perr
	}
	return data, nil
}

func (s *VisitorSessionStore) persist(
	ctx context.Context, token string, data *VisitorSessionData,
) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("encode visitor session: %w", err)
	}
	key := visitorSessionKeyPfx + token
	if serr := s.rdb.Set(ctx, key, payload, visitorSessionTTL).Err(); serr != nil {
		return fmt.Errorf("redis set visitor session: %w", serr)
	}
	return nil
}
