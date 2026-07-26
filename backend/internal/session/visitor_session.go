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

	"github.com/atmaxmoj/standmeet/internal/access"
)

const (
	visitorTokenBytes    = 32
	visitorTokenPrefix   = "smv_"
	visitorSessionTTL    = 60 * time.Minute
	visitorSessionKeyPfx = "vsession:"
	codeSessionsKeyPfx   = "vsessions:code:"
)

// ErrVisitorSessionNotFound —— Redis 里没这个 session（已 expire 或 revoke）。
var ErrVisitorSessionNotFound = errors.New("visitor session not found")

// VisitorSessionData —— Redis 里存的 visitor session payload。
//
// 准入字段：
//   - Mode: 'code' / 'public' / 'byoai'。三者都强制挂 RoleSnapshot（A.3-IAM-5
//     起 ACL 全部走 [[role_snapshot]].AllowsCorpus URI-glob）。public / byoai
//     走 owner 的 public role；code 走 access_code.assumed_role_id。
//   - RoleSnapshot: session issue 时 freeze 出 role 当时的完整状态（corpus
//     URIs / prompt / skills / mcp）。session 整个生命周期不再回头读 role
//     行 —— 唯一补救 = revoke code。
//
// **不存** BYOAI provider + key —— 这两个都在 browser 一处保管
// (localStorage 加密 vault)。visitor 每次 chat 在 `X-BYOAI-Provider` +
// `X-BYOAI-Key` headers 把 provider 名 + 信封过的 key 带过来，server
// 用 HKDF(session_token) 派生的 AES-GCM 解封即用即丢。
// 集中存储：browser 一处，session 不分摊。
type VisitorSessionData struct {
	ExpiresAt    time.Time            `json:"expires_at"`
	MaxBookings  *int32               `json:"max_bookings,omitempty"`
	RoleSnapshot *access.RoleSnapshot `json:"role_snapshot"`
	OwnerID      string               `json:"owner_id"`
	Mode         string               `json:"mode"`
	CodeID       string               `json:"code_id"`
	MemberID     string               `json:"member_id"`
	// Visitor —— 访客自述身份(name + 可选 email)。挂 session(visitor 身份),
	// 不挂 chat。booker 拿 Email 当 visitor_email 兜底。
	Visitor access.VisitorProfile `json:"visitor"`
	// VisitedWaypoints —— ghost-steering 的 waypoint ledger:已到访的 waypoint_id 集
	// (引用命中 evidence_refs / booking 命中 terminal → 加入)。ghost policy 只推未访问的;
	// 全到 = destination reached。机械标记,无 LLM 判官(α≈0)。
	VisitedWaypoints []string `json:"visited_waypoints,omitempty"`
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
	// persist now also maintains the code→sessions index (see persist), so no separate indexByCode.
	if perr := s.persist(ctx, token, data); perr != nil {
		return IssuedVisitor{}, perr
	}
	return IssuedVisitor{Token: token, Data: *data}, nil
}

// DeleteByCode —— revoke code 时清掉这张 code 的所有 visitor session。token 真死后,
// 下一请求 resolveVisitor 的 Sessions.Get miss → 401 + 清 cookie(失效清理是「被发现
// 无效」时做,不是 revoke 直接碰浏览器)。
func (s *VisitorSessionStore) DeleteByCode(ctx context.Context, codeID string) error {
	if codeID == "" {
		return nil
	}
	key := codeSessionsKeyPfx + codeID
	tokens, err := s.rdb.SMembers(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("redis smembers code sessions: %w", err)
	}
	if derr := s.delTokens(ctx, tokens); derr != nil {
		return derr
	}
	if derr := s.rdb.Del(ctx, key).Err(); derr != nil {
		return fmt.Errorf("redis del code session set: %w", derr)
	}
	return nil
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

// Save —— 把改过的 session data 写回(刷新 TTL)。ghost waypoint ledger 标 visited 后存盘用。
func (s *VisitorSessionStore) Save(
	ctx context.Context, token string, data *VisitorSessionData,
) error {
	data.ExpiresAt = time.Now().Add(visitorSessionTTL)
	return s.persist(ctx, token, data)
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
	// #8: keep the code→sessions index alive alongside the session. The token key's TTL slides on
	// every access; the index set must slide with it, else a session active past the initial issue
	// TTL falls out of the index and revoke (DeleteByCode) silently misses it.
	return s.indexByCode(ctx, data.CodeID, token)
}

// indexByCode —— 把 token 记进这张 code 的 session 集合,供 revoke 一次清掉。无 code
// (public/byoai)跳过。
func (s *VisitorSessionStore) indexByCode(ctx context.Context, codeID, token string) error {
	if codeID == "" {
		return nil
	}
	key := codeSessionsKeyPfx + codeID
	if err := s.rdb.SAdd(ctx, key, token).Err(); err != nil {
		return fmt.Errorf("redis index session by code: %w", err)
	}
	if err := s.rdb.Expire(ctx, key, visitorSessionTTL).Err(); err != nil {
		return fmt.Errorf("redis expire code session set: %w", err)
	}
	return nil
}

func (s *VisitorSessionStore) delTokens(ctx context.Context, tokens []string) error {
	for _, t := range tokens {
		if err := s.rdb.Del(ctx, visitorSessionKeyPfx+t).Err(); err != nil {
			return fmt.Errorf("redis del visitor session: %w", err)
		}
	}
	return nil
}
