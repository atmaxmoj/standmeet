// ip_tally.go — the machine behind "the same source does the same thing too
// many times → block it, one solved human check lifts it".
//
// It's extracted from code_guard: that logic (count per IP / block at
// threshold / a valid captcha token lifts it when captcha is on / fail
// closed on redis hiccups / fall back to a named shared bucket when the
// address can't be resolved) doesn't depend on **what** is being counted.
// Access-code redemption counts **failures**; the access-request endpoint
// counts **submissions** — the only differences are the name, threshold,
// and window.
//
// The extraction wasn't done for tidiness — the access-request endpoint
// originally had no gate at all (F-G-4), and the cheapest write at the time
// would have been to copy code_guard. A copied second version drifts on its
// own: one side gets a fail-closed fix, the other doesn't; one side wires
// up the captcha unlock, the other stays permanently hard-locked. This repo
// has paid for that same mistake more than once.

package middleware

import (
	"context"
	"errors"
	"time"

	"github.com/redis/go-redis/v9"
)

// ipTally is one named per-IP counting gate.
type ipTally struct {
	rdb       *redis.Client
	verifier  CaptchaVerifier
	keyPrefix string
	max       int
	window    time.Duration
	captchaOn bool
}

// enabled — only counts when redis is actually wired up. nil → no-op
// (optional/testable).
func (t *ipTally) enabled() bool { return t != nil && t.rdb != nil }

// key is the bucketing key. Empty ip = clientaddr couldn't resolve the
// visitor's address (the out-of-the-box shape, with no reverse proxy
// setting a forwarded header); at that point **everyone shares one
// bucket**: turning the gate off would hand this endpoint to scripts, so
// fail-closed is the better trade. But that bucket needs a name — it once
// silently landed on the app container's own address, looking like it was
// bucketing by IP when it wasn't (F-F-5).
func (t *ipTally) key(ip string) string {
	if ip == "" {
		ip = unknownIPBucket
	}
	return t.keyPrefix + ip
}

// record — logs one occurrence. Best-effort: sets the window expiry only
// the first time the key is written.
func (t *ipTally) record(ctx context.Context, ip string) {
	if !t.enabled() {
		return
	}
	k := t.key(ip)
	if t.rdb.Incr(ctx, k).Val() == 1 {
		t.rdb.Expire(ctx, k, t.window)
	}
}

// reset — clears the count. Best-effort.
func (t *ipTally) reset(ctx context.Context, ip string) {
	if t.enabled() {
		t.rdb.Del(ctx, t.key(ip))
	}
}

// hasLift — whether the blocked person **currently has a way out they can
// walk themselves**. Only true when captcha is on; when it's off, this lock
// can only be waited out until the window expires. Whoever writes the
// refusal message needs to ask this: saying "clear one human check and
// you're through" when there's no check on screen, and saying "try again
// later" when it actually clears in a second, are the same lie pointed in
// two directions ([[names-that-lie]]).
func (t *ipTally) hasLift() bool { return t != nil && t.captchaOn }

// blocked — whether this IP should currently be blocked: redis is wired
// up, and it's over threshold, and captcha hasn't lifted it.
func (t *ipTally) blocked(ctx context.Context, ip, captchaToken string) bool {
	return t.enabled() && t.overThreshold(ctx, ip) && t.captchaFails(ctx, captchaToken, ip)
}

// overThreshold — whether the window has already hit the cap. A redis
// error → fail-closed (don't allow through during a hiccup).
func (t *ipTally) overThreshold(ctx context.Context, ip string) bool {
	n, err := t.rdb.Get(ctx, t.key(ip)).Int()
	if errors.Is(err, redis.Nil) {
		return false
	}
	if err != nil {
		return true
	}
	return n >= t.max
}

// captchaFails — captcha off (the default deployment) → always true (a
// pure hard lock, since there's no check to solve); captcha on → only lets
// through when a valid token is presented.
func (t *ipTally) captchaFails(ctx context.Context, captchaToken, ip string) bool {
	return !t.captchaOn || t.verifier.Verify(ctx, captchaToken, ip) != nil
}
