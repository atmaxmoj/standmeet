// credential_guard.go — brute-force protection for the two credential-change
// routes.
//
// **Why LoginGuard isn't enough**: the front door, `/login` and
// `/recover`, already has LoginGuard, but `/account/email` and
// `/account/password` had neither. Someone will say these two sit behind a
// session, so an attacker needs a session first — **that's exactly the
// problem**: the entire reason the current-password gate exists is that
// "stealing a session shouldn't equal taking over the account." And right
// now, whoever has stolen a session can hammer `/account/password` with
// unlimited, full-speed password guesses, without hitting a single rate
// limit. The front door has a lock; the safe dial inside can be spun freely.
//
// Three differences from LoginGuard, each deliberate:
//
//  1. **The key is the owner, not the IP.** Every request here already
//     carries a session, and the session says who this is. Keying by IP
//     means moving the same stolen cookie to another machine resets the
//     count ([[read-the-key-not-the-name]]: for a mechanism that claims to
//     bucket "by X", go check what it actually keys on).
//  2. **Only failures are counted.** Counting every request would lock the
//     owner out just for changing their email a few normal times — that's
//     shifting the system's limitation onto the user's discipline. So the
//     next handler's response is buffered first, and only a 4xx counts.
//  3. **No captcha.** Captcha defends against "something automated acting
//     on the owner's own instance in the owner's place," and here the
//     owner is the one already inside their own backend.
//
// The threshold is much tighter than the front door's: changing a
// credential is a low-frequency action, so 5 attempts / 15 minutes is
// plenty for a real person and meaningless for a brute force.

package middleware

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// This is a redis key prefix, not a credential itself — gosec only
	// sees the word "credential".
	credRateLimitKeyPfx = "ratelimit:credential:" //nolint:gosec // redis key prefix
	credRateLimitWindow = 15 * time.Minute
	// 5/15min/owner: a real person needs one attempt to change a
	// credential; 5 failures already says this isn't the owner doing it.
	credRateLimitMax = 5
	// The fallback bucket for when there's no owner id. This shouldn't be
	// reachable (this middleware sits after WithOwner), but if it is
	// reached it still needs a bucket — it must never become "no id means
	// no rate limit".
	credUnknownOwner = "<unknown-owner>"
)

// CredentialGuard wraps /account/email and /account/password. Both routes
// lead to the same thing (a credential change), so **both must be
// wrapped** — wrapping just one is the same as wrapping none
// ([[gate-after-early-return-is-walkable]]: a different entry point walks
// right around it).
func CredentialGuard(rdb *redis.Client) func(http.Handler) http.Handler {
	if rdb == nil {
		panic("CredentialGuard: redis client is nil")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveCredentialGuard(w, r, rdb, next)
		})
	}
}

func serveCredentialGuard(
	w http.ResponseWriter, r *http.Request, rdb *redis.Client, next http.Handler,
) {
	owner := credOwnerBucket(r.Context())
	blocked, err := credOverLimit(r.Context(), rdb, owner)
	if err != nil {
		// Fail-closed on a redis hiccup — don't let a brute-forcer get a
		// free ride during the outage window (same stance as LoginGuard).
		slog.Default().Error("credential rate-limit check", "err", err, "owner", owner)
		writeRateError(
			w, http.StatusServiceUnavailable, "rate_limit_unavailable",
			"credential change temporarily unavailable, try again",
		)
		return
	}
	if blocked {
		writeRateError(
			w, http.StatusTooManyRequests, "rate_limited",
			"too many failed attempts — wait a few minutes before trying again",
		)
		return
	}
	credServeAndCountFailures(w, r, rdb, owner, next)
}

// credServeAndCountFailures buffers first, then decides whether to count
// once it's clear whether the status is a 4xx.
func credServeAndCountFailures(
	w http.ResponseWriter, r *http.Request, rdb *redis.Client, owner string, next http.Handler,
) {
	buf := &bufferedWriter{ResponseWriter: w, body: &bytes.Buffer{}, status: http.StatusOK}
	next.ServeHTTP(buf, r)
	if buf.status >= http.StatusBadRequest {
		if err := credCountFailure(r.Context(), rdb, owner); err != nil {
			slog.Default().Error("credential failure count", "err", err, "owner", owner)
		}
	}
	buf.flushTo(w)
}

func credOwnerBucket(ctx context.Context) string {
	if id := OwnerIDFrom(ctx); id != "" {
		return id
	}
	return credUnknownOwner
}

// credOverLimit only **reads**, it doesn't count — a successful request
// shouldn't consume the quota.
func credOverLimit(ctx context.Context, rdb *redis.Client, owner string) (bool, error) {
	n, err := rdb.Get(ctx, credRateLimitKeyPfx+owner).Int64()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return false, nil
		}
		return false, fmt.Errorf("redis get: %w", err)
	}
	return n >= credRateLimitMax, nil
}

// credCountFailure is fixed-window: EXPIRE is set only on the first INCR,
// so a refresh doesn't keep extending the window.
func credCountFailure(ctx context.Context, rdb *redis.Client, owner string) error {
	key := credRateLimitKeyPfx + owner
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("redis incr: %w", err)
	}
	if n == 1 {
		if eerr := rdb.Expire(ctx, key, credRateLimitWindow).Err(); eerr != nil {
			return fmt.Errorf("redis expire: %w", eerr)
		}
	}
	return nil
}
