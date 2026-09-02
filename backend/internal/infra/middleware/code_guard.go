// code_guard.go — #169 pentest fix: per-IP failure lockout for access-code
// redemption.
//
// Access codes are guessable LABEL-XXX strings, and the redemption path had
// no failure lockout — it could be brute-forced at full speed to grab
// someone else's RoleSnapshot. This guard mirrors login_guard's protection
// level: it counts only **invalid** codes (a valid redemption Resets the
// count, so legitimate visitors aren't self-DoS'd), and once failures in
// the same IP window exceed the threshold → hard lock (429). Redis failure
// fails closed (don't let a brute-forcer get a free ride while redis is
// flaky). With captcha on, exceeding the threshold can be lifted with a
// valid captcha token; with captcha off (noop, the default deployment) —
// pure hard lock, since there's no captcha to solve.
//
// Note: per-IP relies on the **visitor** address that clientaddr resolves
// (not the previous hop's address). When it can't be resolved, this falls
// back to one named shared bucket, and says so plainly in the logs — at
// that point "per-IP" isn't accurate, and ops needs to know (F-F-5).
// X-Forwarded-For being spoofable is a separate infra concern (login guard
// has the same issue, relying on a trusted reverse proxy to strip/set XFF).
//
// Lives in middleware (same layer as login_guard, same captcha+redis
// dependency): public routes see only one narrow interface
// (publicroutes.CodeGuard), and the captcha dependency stays hidden behind
// this layer boundary, never leaking into routes/public.

package middleware

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	// codeFailMax — the number of invalid codes allowed from one IP within
	// the window; exceeding it locks. Generous enough for a normal
	// visitor's typo, not enough for enumeration.
	codeFailMax = 10
	// codeFailWindow — the failure-counting window (also the lockout
	// duration).
	codeFailWindow = 15 * time.Minute
)

// CodeGuard — failure lockout for access-code redemption. The counting
// mechanism lives in ip_tally; this just picks the name, threshold, and
// window.
// rdb nil → degrades to a no-op (optional/testable).
type CodeGuard struct{ t ipTally }

// NewCodeGuard — composition-root wiring; captchaOn says whether captcha is
// really enabled (not the noop).
func NewCodeGuard(rdb *redis.Client, verifier CaptchaVerifier, captchaOn bool) *CodeGuard {
	return &CodeGuard{t: ipTally{
		rdb: rdb, verifier: verifier, captchaOn: captchaOn,
		keyPrefix: "codefail:ip:", max: codeFailMax, window: codeFailWindow,
	}}
}

// Locked — whether this IP should be refused: redis is wired up, failures
// are over the threshold, and captcha hasn't lifted it.
func (g *CodeGuard) Locked(ctx context.Context, ip, captchaToken string) bool {
	if g == nil {
		return false
	}
	return g.t.blocked(ctx, ip, captchaToken)
}

// HasLift — whether this instance can currently offer that way out (only
// when captcha is on). The refusal message picks its wording from this.
func (g *CodeGuard) HasLift() bool {
	return g != nil && g.t.hasLift()
}

// RecordFail — one invalid code. **Counts only invalid ones**: a valid
// redemption Resets it, so a legitimate visitor isn't dragged down by past
// failures.
func (g *CodeGuard) RecordFail(ctx context.Context, ip string) {
	if g != nil {
		g.t.record(ctx, ip)
	}
}

// Reset — a valid redemption: clears the count.
func (g *CodeGuard) Reset(ctx context.Context, ip string) {
	if g != nil {
		g.t.reset(ctx, ip)
	}
}
