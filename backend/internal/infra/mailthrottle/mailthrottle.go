// Package mailthrottle caps outbound mail PER RECIPIENT — defense-in-depth against an email bomb.
// Even if a public/code-gated action that sends mail is abused, one victim's address can't be
// blasted past a fixed-window budget. Fail-open on any Redis error: throttling must never break a
// legitimate send. See docs/design/email-recipient-throttle.md (Q4).
package mailthrottle

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	keyPrefix     = "mail:rcpt:"
	defaultBudget = 30 // sends/recipient/window — above any legit flow, caps abuse
	defaultWindow = time.Hour
)

// Counter — the minimal Redis surface Allow needs, so the budget decision is unit-testable with a
// fake (no live Redis).
type Counter interface {
	Incr(ctx context.Context, key string) (int64, error)
	SetTTL(ctx context.Context, key string, ttl time.Duration) error
}

// Throttle — a fixed-window per-recipient cap.
type Throttle struct {
	c      Counter
	budget int64
	window time.Duration
}

// New — a throttle with the default budget/window. A nil Counter → Allow always true (disabled).
func New(c Counter) *Throttle {
	return NewWithBudget(c, defaultBudget, defaultWindow)
}

// NewWithBudget — a throttle with an explicit budget/window (config + tests).
func NewWithBudget(c Counter, budget int64, window time.Duration) *Throttle {
	return &Throttle{c: c, budget: budget, window: window}
}

// recipientKey — the Redis key for a recipient: a hash, NEVER the raw address (no PII in keys).
// Normalized (trim + lowercase) so "A@x.io" and "a@x.io " share one bucket.
func recipientKey(recipient string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(recipient))))
	return keyPrefix + hex.EncodeToString(sum[:])
}

// Allow — may this send to `recipient` proceed? Increments the recipient's fixed-window counter;
// over budget → false. A nil throttle/counter or any Redis error → true (fail-open: never break a
// real send just because the limiter hiccuped).
func (t *Throttle) Allow(ctx context.Context, recipient string) bool {
	if t == nil || t.c == nil {
		return true
	}
	n, counted := t.bump(ctx, recipientKey(recipient))
	return !counted || n <= t.budget // a Redis error (counted=false) fails open
}

// bump — increments the recipient's counter and, on the first hit of a window, starts its TTL.
// Returns (count, counted); counted=false means a Redis error (the caller fails open).
func (t *Throttle) bump(ctx context.Context, key string) (int64, bool) {
	n, err := t.c.Incr(ctx, key)
	if err != nil {
		return 0, false
	}
	if n == 1 {
		if terr := t.c.SetTTL(ctx, key, t.window); terr != nil {
			return n, true // window unset; n==1 is under budget anyway, self-heals next send
		}
	}
	return n, true
}

// RedisCounter — Counter backed by a *redis.Client (the production wiring).
type RedisCounter struct{ RDB *redis.Client }

// Incr implements Counter.
func (r RedisCounter) Incr(ctx context.Context, key string) (int64, error) {
	n, err := r.RDB.Incr(ctx, key).Result()
	if err != nil {
		return 0, fmt.Errorf("mailthrottle incr: %w", err)
	}
	return n, nil
}

// SetTTL implements Counter.
func (r RedisCounter) SetTTL(ctx context.Context, key string, ttl time.Duration) error {
	if err := r.RDB.Expire(ctx, key, ttl).Err(); err != nil {
		return fmt.Errorf("mailthrottle expire: %w", err)
	}
	return nil
}
