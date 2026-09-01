// nonce_store.go —— owner.NonceStore 的 Redis 实现（Sigv1 一次性 nonce，防重放）。
// SetNX：key 不存在则设并返 true（首见）；已存在返 false（重放）。TTL 让 nonce 自动回收
// （ts 早已过窗口，无需永久保留）。

package port

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/redis/go-redis/v9"
)

// RedisNonceStore —— 一次性 nonce 的 Redis 实现（Sigv1 + embed JWT 共用）。导出为具体类型，
// 让构造器返回它本身而不是接口（ireturn：返结构、别返接口）；owner/access 两侧各自把它当各自的
// NonceStore 接口用。
type RedisNonceStore struct{ rdb *redis.Client }

// Fresh —— SetNX 原子「首见即占」：返 (true,nil)=首次；(false,nil)=已见=重放；(_,err)=Redis 错。
func (s RedisNonceStore) Fresh(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	fresh, err := s.rdb.SetNX(ctx, key, 1, ttl).Result()
	if err != nil {
		return false, fmt.Errorf("nonce setnx: %w", err)
	}
	return fresh, nil
}

// KeypairDeps —— 组 KeypairDeps（含 Sigv1 nonce store），两处 composition 共用。
func KeypairDeps(d *deps.Runtime) owner.KeypairDeps {
	return owner.KeypairDeps{Repo: d.KeypairRepo, Log: d.Log, Nonce: RedisNonceStore{rdb: d.RDB}}
}

// EmbedNonceStore —— embed JWT 的一次性 jti store（防重放）。跟 Sigv1 同一个 Redis 实现，
// 只是 embed 侧 fail-closed（在 usecase 里判）。返回具体类型，赋给 Handlers 那个接口字段。
func EmbedNonceStore(d *deps.Runtime) RedisNonceStore {
	return RedisNonceStore{rdb: d.RDB}
}
