// request_guard.go — the per-IP gate on the access-request endpoint
// (`POST /access-requests`) (F-G-4).
//
// That endpoint is an **unauthenticated write**, and the queue it writes
// into is one the owner **reads by hand, one at a time** (the gate's own
// words: "Read by hand, not a queue."). Before this, its only protection
// was the generic 30/min/IP rate limit, and that layer **fails open**: one
// redis hiccup and everything gets through. Verified in prod: the same IP
// sent 34 requests back to back, and the first 30 all landed in the table.
//
// The one difference from the code-redemption gate: that one counts
// **failures** (guessed codes); this one counts **submissions** — an
// access request has no right or wrong answer, volume itself is the
// signal. The mechanism reuses ipTally rather than copying it again (a
// copied second version drifts on its own).
//
// The threshold is pitched at "a real person wouldn't send this many in a
// quarter hour" — honestly, one message is enough. Captcha on → exceeding
// the threshold can be lifted with a valid token (a person can still get
// through, a script pays a cost); captcha off → pure hard lock, the same
// trade-off as code redemption.

package middleware

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// requestMax — the number of access requests allowed from one IP
	// within the window.
	requestMax = 5
	// requestWindow — the counting window (i.e. the lockout duration).
	requestWindow = 15 * time.Minute
)

// RequestGuard is the per-IP gate for the access-request endpoint. rdb nil
// → no-op.
type RequestGuard struct{ t ipTally }

// NewRequestGuard — composition-root wiring; captchaOn says whether
// captcha is really enabled (not the noop).
func NewRequestGuard(rdb *redis.Client, verifier CaptchaVerifier, captchaOn bool) *RequestGuard {
	return &RequestGuard{t: ipTally{
		rdb: rdb, verifier: verifier, captchaOn: captchaOn,
		keyPrefix: "requestflood:ip:", max: requestMax, window: requestWindow,
	}}
}

// Locked — whether this IP should currently be blocked.
func (g *RequestGuard) Locked(ctx context.Context, ip, captchaToken string) bool {
	if g == nil {
		return false
	}
	return g.t.blocked(ctx, ip, captchaToken)
}

// HasLift — whether this instance can currently offer that way out (only
// when captcha is on). The refusal message picks its wording from this.
func (g *RequestGuard) HasLift() bool {
	return g != nil && g.t.hasLift()
}

// RecordSubmit — logs one submission. **Counts successes too**: this
// counts volume, not errors.
func (g *RequestGuard) RecordSubmit(ctx context.Context, ip string) {
	if g != nil {
		g.t.record(ctx, ip)
	}
}
