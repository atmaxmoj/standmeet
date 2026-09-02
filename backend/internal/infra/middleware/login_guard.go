package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/infra/clientaddr"
)

// CaptchaVerifier is the narrow captcha-verification interface the
// middleware needs. It doesn't import the security domain (leaf infra
// doesn't depend on a domain); the composition root satisfies it with a
// structurally matching CaptchaVerifier.
type CaptchaVerifier interface {
	Verify(ctx context.Context, token, remoteIP string) error
}

const (
	loginRateLimitKeyPfx = "ratelimit:login:"
	loginRateLimitWindow = 5 * time.Minute
	// 30/5min/IP: enough for the owner to retry / for e2e to run through,
	// not enough for a brute force.
	loginRateLimitMax = 30
	// The uniform minimum response time. Every login response (200/401/429)
	// is padded up to this floor.
	loginMinResponseTime = 200 * time.Millisecond
)

// LoginGuard is a chi middleware factory; wrapped around the single
// `/api/admin/login` handler.
//
// Protections:
//  1. Per-IP Redis rate-limit (fixed window, INCR+EXPIRE). Over the limit
//     returns 429. Fail-closed (503) on a redis failure — don't let a
//     brute-forcer get a free ride while redis is flaky.
//  2. Captcha verify (opt-in) — if a non-noop verifier is wired up, checks
//     the `X-Captcha-Token` header; a failure returns a uniform 401,
//     matching a wrong-password response, so the attacker isn't told which
//     check failed.
//  3. Equal-time response: the next handler's writes are buffered first,
//     then flushed only after sleeping to ≥ 200ms. Timing no longer leaks
//     the difference between email-exists and wrong-password.
//
// Does not cover /api/admin/claim — the setup token is single-use and
// hash-checked; brute-forcing a ~22-char random token isn't practical.
//
// rdb / verifier are required; nil panics immediately (a composition root
// bug). When captcha is off, just pass
// security.NewFromConfig(Config{Provider: ProviderNone}, nil).
func LoginGuard(
	rdb *redis.Client, verifier CaptchaVerifier, captchaOn bool,
) func(http.Handler) http.Handler {
	if rdb == nil {
		panic("LoginGuard: redis client is nil")
	}
	if verifier == nil {
		panic("LoginGuard: captcha verifier is nil")
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveLoginGuard(w, r, &loginGuardCtx{
				rdb: rdb, verifier: verifier, next: next, captchaOn: captchaOn,
			})
		})
	}
}

// loginGuardCtx is the 4 refs LoginGuard's closure needs to pass along;
// bundled so serveLoginGuard doesn't exceed 4 params (revive
// argument-limit).
type loginGuardCtx struct {
	rdb      *redis.Client
	verifier CaptchaVerifier
	next     http.Handler
	// captchaOn — whether this instance has captcha configured (a
	// deployment fact). It decides which message is shown when the limit
	// is hit, and whether that way out even exists. The two messages are
	// `tooManyAttemptsWait/Captcha`.
	captchaOn bool
}

// tooManyAttemptsWait / tooManyAttemptsCaptcha — the two over-limit
// messages. Saying "try again later" when the check is right there on
// screen makes the owner wait five minutes for nothing; saying "clear one
// check" when this instance has no captcha configured points at a control
// that doesn't exist on the page (the same rule as F-G-7, a third door).
const (
	tooManyAttemptsWait    = "too many login attempts, try again later"
	tooManyAttemptsCaptcha = "too many login attempts — clear the human check and try again"
)

func serveLoginGuard(w http.ResponseWriter, r *http.Request, c *loginGuardCtx) {
	ip := clientIP(r)
	if !checkRateOrWrite(w, r, c, ip) {
		return
	}
	if !checkCaptchaOrWrite(w, r, c.verifier, ip) {
		return
	}
	equalTimeServe(w, r, c.next)
}

// checkRateOrWrite — hitting the rate-limit / a redis failure → writes the
// response and returns false; allowed through returns true.
//
// **Even over the limit there's a way out, as long as this instance can
// offer one**: with captcha configured, a token that verifies lifts the
// block and clears the count. The gate's other two doors (code / access
// request) already worked this way, while the owner's own door had no key
// for it — a fully correct password and a solved check still left them
// locked out of their own instance until the window expired on its own
// (F-G-8).
//
// This isn't tearing down the defense: with captcha on, **every** login
// already has to pass that check, so a brute-forcer is already paying a
// cost per attempt — the attempt-count cap at that point can't stop them
// anyway, it only stops the person who should be let in. With captcha off
// there's no token to verify, so the hard lock stays — at that point it's
// the only defense there is.
func checkRateOrWrite(
	w http.ResponseWriter, r *http.Request, c *loginGuardCtx, ip string,
) bool {
	outcome, err := checkLoginRate(r.Context(), c.rdb, ip)
	if err != nil {
		handleRateError(w, ip, err)
		return false
	}
	if outcome {
		return true
	}
	return liftOrRefuse(w, r, c, ip)
}

// liftOrRefuse — once over the limit: a token that verifies lifts the gate
// and clears the count; otherwise refuse, and **only promise a next step
// that actually exists here**.
func liftOrRefuse(
	w http.ResponseWriter, r *http.Request, c *loginGuardCtx, ip string,
) bool {
	token := r.Header.Get(captchaTokenHeader)
	// `c.captchaOn` must come first: with captcha off, the verifier wired
	// up is a noop — one that returns success for **any** token. Without
	// this half of the check, this rate limit would get lifted open by its
	// own no-op on every default deployment, effectively not existing.
	// `ipTally.captchaFails` already gets this right; this spot nearly
	// missed the same rule (the same family: one lesson fixed in only one
	// place).
	if c.captchaOn && c.verifier.Verify(r.Context(), token, ip) == nil {
		slog.Default().Info("login rate lifted by a solved check", "ip", ip)
		c.rdb.Del(r.Context(), loginRateLimitKeyPfx+ip)
		return true
	}
	slog.Default().Warn("login rate-limited", "ip", ip)
	refusal := tooManyAttemptsWait
	if c.captchaOn {
		refusal = tooManyAttemptsCaptcha
	}
	writeRateError(w, http.StatusTooManyRequests, "rate_limited", refusal)
	return false
}

// checkCaptchaOrWrite — the captcha check failing → writes 401 and returns
// false; passing returns true. The noop verifier always returns true
// (feature off).
//
// **This talks about the check, not the credential** (F-G-5). This step
// short-circuits before the credential check, so an owner with a fully
// correct password still lands here whenever the widget just fails to load
// (network blocked, the provider hiccups, an ad blocker) — an earlier
// version returned `invalid credentials` here, sending them off to reset
// their password when the real cause was elsewhere.
//
// "Anti-enumeration" doesn't apply here: wrong-password vs. no-such-user
// needs to stay vague to avoid revealing whether an account exists; "the
// human check didn't pass" isn't an account oracle — saying it plainly
// leaks nothing. The sibling rate-limit branch already tells the truth
// here; this one follows suit.
//
// Also doesn't echo back the provider's own error-code array: that's a
// third party's internal wording, not something the product should say.
func checkCaptchaOrWrite(
	w http.ResponseWriter, r *http.Request, v CaptchaVerifier, ip string,
) bool {
	token := r.Header.Get(captchaTokenHeader)
	if err := v.Verify(r.Context(), token, ip); err != nil {
		slog.Default().Warn("captcha verify failed", "err", err, "ip", ip)
		writeRateError(
			w, http.StatusUnauthorized, "captcha_failed",
			"the human check didn’t go through — reload the page and try again",
		)
		return false
	}
	return true
}

// captchaTokenHeader — the frontend LoginForm sends the widget token over
// X-Captcha-Token. Not put in the body, so LoginGuard doesn't need to parse
// JSON; the header follows the same pattern as CSRF.
// gosec G101 misflags "Token" as a hardcoded credential — this is only a
// header name.
const captchaTokenHeader = "X-Captcha-Token" //nolint:gosec // header name, not a credential

// clientIP is the bucketing key for login rate-limiting. It's the
// clientaddr middleware's conclusion: either the visitor's own address, or
// an empty string (unknown). **When unknown, everyone shares one bucket**
// — that's the fail-closed trade-off (turning the rate limit off would
// hand the owner's login over to brute force), but it must be one
// **explicitly named** bucket, not silently landing on the app container's
// own address pretending to bucket by IP (F-F-5).
func clientIP(r *http.Request) string {
	if addr := clientaddr.Of(r.Context()); addr != "" {
		return addr
	}
	return unknownIPBucket
}

// unknownIPBucket is the shared bucket name for when the source address
// isn't visible. Named plainly, so ops seeing
// `login:rate:<unknown-source>` in redis knows right away this isn't a
// visitor's actual address.
const unknownIPBucket = "<unknown-source>"

// checkLoginRate is fixed-window: EXPIRE is set only when the first INCR
// returns 1, so a refresh doesn't keep extending the window. Returns
// true=allowed, false=over the limit.
func checkLoginRate(ctx context.Context, rdb *redis.Client, ip string) (bool, error) {
	key := loginRateLimitKeyPfx + ip
	n, err := rdb.Incr(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("redis incr: %w", err)
	}
	if n == 1 {
		if eerr := rdb.Expire(ctx, key, loginRateLimitWindow).Err(); eerr != nil {
			return false, fmt.Errorf("redis expire: %w", eerr)
		}
	}
	return n <= loginRateLimitMax, nil
}

func handleRateError(w http.ResponseWriter, ip string, err error) {
	slog.Default().Error("login rate-limit check", "err", err, "ip", ip)
	writeRateError(
		w, http.StatusServiceUnavailable, "rate_limit_unavailable",
		"login service temporarily unavailable, try again",
	)
}

// equalTimeServe wraps the ResponseWriter, intercepting the next handler's
// writes, and only flushes to the real writer after sleeping up to
// loginMinResponseTime. The next handler's SetCookie goes through
// b.Header(), forwarded straight to the real writer's header map — so when
// flush calls WriteHeader, the headers go out together with it.
func equalTimeServe(w http.ResponseWriter, r *http.Request, next http.Handler) {
	start := time.Now()
	buf := &bufferedWriter{ResponseWriter: w, body: &bytes.Buffer{}, status: http.StatusOK}
	next.ServeHTTP(buf, r)
	if remaining := loginMinResponseTime - time.Since(start); remaining > 0 {
		select {
		case <-time.After(remaining):
		case <-r.Context().Done():
		}
	}
	buf.flushTo(w)
}

// bufferedWriter —
//
//	WriteHeader intercepts the status;
//	Write intercepts the body;
//	Header delegates straight through (so SetCookie/Set Content-Type all
//	still go through the real writer's header map as usual — the headers
//	go out together once flushTo actually calls WriteHeader).
type bufferedWriter struct {
	http.ResponseWriter

	body        *bytes.Buffer
	status      int
	wroteHeader bool
}

func (b *bufferedWriter) WriteHeader(status int) {
	if b.wroteHeader {
		return
	}
	b.status = status
	b.wroteHeader = true
}

func (b *bufferedWriter) Write(p []byte) (int, error) {
	if !b.wroteHeader {
		b.WriteHeader(http.StatusOK)
	}
	return b.body.Write(p)
}

func (b *bufferedWriter) flushTo(w http.ResponseWriter) {
	w.WriteHeader(b.status)
	if _, err := w.Write(b.body.Bytes()); err != nil {
		slog.Default().Warn("login_guard flush write", "err", err)
	}
}

func writeRateError(w http.ResponseWriter, status int, code, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	payload := map[string]map[string]string{
		"error": {"code": code, "message": msg},
	}
	err := json.NewEncoder(w).Encode(payload)
	if err != nil && !errors.Is(err, http.ErrHandlerTimeout) {
		slog.Default().Warn("encode rate-limit error", "err", err)
	}
}
