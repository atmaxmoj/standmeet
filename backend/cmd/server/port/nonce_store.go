// nonce_store.go — Redis implementation of owner.NonceStore (Sigv1 one-time nonce,
// replay protection). SetNX: sets and returns true if the key doesn't exist yet
// (first sighting); returns false if it already exists (replay). TTL lets nonces
// self-expire (once ts is past the window there's no need to keep it forever).

package port

import (
	"context"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/redis/go-redis/v9"
)

// RedisNonceStore — Redis implementation of one-time nonces (shared by Sigv1 + embed
// JWT). Exported as a concrete type so the constructor returns the struct itself
// rather than an interface (ireturn: return structs, not interfaces); owner/access
// each use it through their own NonceStore interface.
type RedisNonceStore struct{ rdb *redis.Client }

// Fresh — atomic "first sighting claims it" via SetNX: returns (true,nil) = first
// time; (false,nil) = already seen = replay; (_,err) = Redis error.
func (s RedisNonceStore) Fresh(ctx context.Context, key string, ttl time.Duration) (bool, error) {
	fresh, err := s.rdb.SetNX(ctx, key, 1, ttl).Result()
	if err != nil {
		return false, fmt.Errorf("nonce setnx: %w", err)
	}
	return fresh, nil
}

// KeypairDeps — assembles KeypairDeps (including the Sigv1 nonce store), shared by
// two composition sites.
func KeypairDeps(d *deps.Runtime) owner.KeypairDeps {
	return owner.KeypairDeps{Repo: d.KeypairRepo, Log: d.Log, Nonce: RedisNonceStore{rdb: d.RDB}}
}

// EmbedNonceStore — one-time jti store for embed JWT (replay protection). Same Redis
// implementation as Sigv1, except the embed side fails closed (decided in usecase).
// Returns a concrete type, assigned to the Handlers interface field.
func EmbedNonceStore(d *deps.Runtime) RedisNonceStore {
	return RedisNonceStore{rdb: d.RDB}
}
