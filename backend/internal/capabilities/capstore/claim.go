// claim.go —— 单赢占位:同一个 key,同一时刻只有一个调用方拿得到。
//
// 为什么它属于 capstore 而不属于某个能力:任何「先看一眼再动手」的动作都需要它 —— 看和动之间
// 那个窗口里挤进来第二个人,两边都会看见同一个「空着」。F-B-15 是它的第一份账单:两条同时进来的
// 订会请求,忙时检查各自都说这一格空着,于是真日历上并排长出两场会,owner 的同一个半小时被占两次。
//
// 保证由**主键冲突**给,不由代码的先后顺序给:两个并发的 INSERT 只有一个插得进去。过期的占位
// 可以被抢走(TTL),所以一个中途死掉的调用方不会把这一格永远锁死 —— 那种锁比不锁更难查。

package capstore

import (
	"context"
	"fmt"
	"time"
)

// maxClaimTTL —— 占位最长活多久。占位是为了盖住「看一眼 → 动手」那个窗口,不是为了长期持有;
// 上限在这儿,免得一个写错的调用方把一格锁到天荒地老。
const maxClaimTTL = 5 * time.Minute

// ClaimKey —— 占的是谁的哪一格:哪个能力(kind+id)、哪个 collection、哪个 key。
// 打包成一个类型而不是四个位置参数 —— 调用点数逗号数不清哪个是 id 哪个是 key,
// 而这两个错位之后是「占了别人的格子」。
type ClaimKey struct {
	Kind       Kind
	ID         string
	Collection string
	Key        string
}

// Claim —— 试着占住 (collection, key)。true = 这一刻它归你。
//
// 已经被别人占着且还没过期 → false(不是错误:被别人抢先是正常结局,调用方据此换个说法回答)。
// 过期的占位视同没有,谁先来谁拿走。
func (s *Store) Claim(ctx context.Context, c ClaimKey, ttl time.Duration) (bool, error) {
	kind, id, collection, key := c.Kind, c.ID, c.Collection, c.Key
	schema, err := schemaName(kind, id)
	if err != nil {
		return false, err
	}
	sql := fmt.Sprintf(
		`INSERT INTO %s.claims (collection, key, expires_at) VALUES ($1, $2, now() + $3::interval)
		 ON CONFLICT (collection, key) DO UPDATE SET expires_at = excluded.expires_at
		 WHERE %[1]s.claims.expires_at < now()
		 RETURNING true`, schema,
	)
	var got bool
	qerr := s.pool.QueryRow(ctx, sql, collection, key, clampClaimTTL(ttl).String()).Scan(&got)
	if qerr != nil {
		return false, nil //nolint:nilerr // 没插进去 = 被别人占着,是正常结局不是故障
	}
	return got, nil
}

// Release —— 提前放掉自己的占位(做完了 / 失败了)。不放也行:TTL 会到期。
func (s *Store) Release(ctx context.Context, c ClaimKey) error {
	collection, key := c.Collection, c.Key
	schema, err := schemaName(c.Kind, c.ID)
	if err != nil {
		return err
	}
	sql := fmt.Sprintf("DELETE FROM %s.claims WHERE collection = $1 AND key = $2", schema)
	if _, derr := s.pool.Exec(ctx, sql, collection, key); derr != nil {
		return fmt.Errorf("capstore release %q/%s: %w", schema, collection, derr)
	}
	return nil
}

// clampClaimTTL —— 非正数 → 一分钟(调用方没说就给个够盖住那个窗口的默认);超上限 → 截到上限。
func clampClaimTTL(ttl time.Duration) time.Duration {
	if ttl <= 0 {
		return time.Minute
	}
	if ttl > maxClaimTTL {
		return maxClaimTTL
	}
	return ttl
}
