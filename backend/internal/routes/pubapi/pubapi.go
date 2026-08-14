// Package pubapi —— the API-key facade (facade-directions.md): the outward, non-agentic,
// role-scoped programmatic surface at /api/pub/v1. A holder presents `Authorization: Bearer smk_…`;
// the key resolves to a role snapshot (exactly like an access code, minus the LLM and the gas), and
// its HTTP calls dispatch through the SAME capreg assembly the visitor chat tools use — so ACL /
// denial / quota / connector-gate behavior is identical to code by construction. On top of assembly
// the facade adds candidacy (the owner must have "opened" the capability) and the api whitelist
// (only non-Agentic outward tools render). Bounded by rate limiting, not gas.
//
// Handlers stay presentation-only (cyclo ≤3): auth + rate + assembly run as middleware and stash
// their results in context; the branchy toolset assembly lives in capload.AssembleAPIKeyToolset.
package pubapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
	"github.com/atmaxmoj/standmeet/internal/routes/capload"
)

// methodQuery —— HTTP QUERY (RFC 10008), registered on the chi method table at server boot.
const methodQuery = "QUERY"

// rateWindow —— fixed-window length for the per-key limiter.
const rateWindow = time.Minute

// maxAPIBodyBytes —— per-request body cap (DoS bound); a tool arg payload is small JSON.
const maxAPIBodyBytes = 1 << 20

// KeyStore —— everything the facade needs off the api-key persistence (access.APIKeyRepo
// implements it): auth lookup, per-key denials, the owner's opened capabilities, last-used bump.
type KeyStore interface {
	capload.APIToolsetStore
	GetBySecretHash(ctx context.Context, hash []byte) (access.APIKey, error)
	TouchLastUsed(ctx context.Context, id string) error
}

// Deps —— facade dependencies. DefaultRPM is the instance rate ceiling a key overrides via
// rate_limit_rpm.
type Deps struct {
	Keys        KeyStore
	Visitor     *conversation.VisitorSessionDeps
	AgentSkills *capreg.Registry
	Redis       *redis.Client
	Log         *slog.Logger
	DefaultRPM  int
}

// Handlers —— the mounted facade.
type Handlers struct {
	d *Deps
}

// New 构造 facade handlers。
func New(d *Deps) *Handlers { return &Handlers{d: d} }

// Mount —— /api/pub/v1 with api-key auth + rate + assembly as middleware on every route.
func (h *Handlers) Mount(r chi.Router) {
	r.Route("/api/pub/v1", func(r chi.Router) {
		r.Use(h.authRate)
		r.Use(h.assemble)
		r.Get("/tools", h.discover)
		r.Post("/tools/{name}", h.dispatch)
		r.Method(methodQuery, "/tools/{name}", http.HandlerFunc(h.dispatch))
	})
}

type ctxKey int

const (
	keyCtxKey ctxKey = iota
	toolsetCtxKey
)

// authRate —— resolve the `Bearer smk_…` secret to an active key, then rate-limit it. Bad key → 401
// (constant envelope). Over the limit → 429.
func (h *Handlers) authRate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, err := access.ResolveAPIKey(r.Context(), h.d.Keys, bearerSecret(r))
		if err != nil {
			h.writeErr(w, http.StatusUnauthorized, "unauthorized", "invalid or missing api key")
			return
		}
		if allowed, wait := h.rateVerdict(r.Context(), &key); !allowed {
			// Retry-After —— **说清什么时候能再试**(F-K-2)。只说"你被限了"的话,守规矩的客户端
			// 也只能猜,而最常见的猜法是立刻重试 —— 恰恰是限流要防的那件事。
			// 这个秒数不是估的:它是那把 Redis 计数键的剩余 TTL,也就是窗口真正还剩多久。
			w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(wait.Seconds()))))
			h.writeErr(w, http.StatusTooManyRequests, "rate_limited",
				"rate limit exceeded — retry after the window resets")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), keyCtxKey, &key)))
	})
}

// assemble —— freeze the key's toolset (grant ∩ opened ∩ whitelist) into context for the handlers.
func (h *Handlers) assemble(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := keyFromCtx(r.Context())
		ts, err := capload.AssembleAPIKeyToolset(
			r.Context(), h.toolsetDeps(), key, paritymanifest.APIRenderableTools(),
		)
		if err != nil {
			h.d.Log.Error("api assemble toolset", "err", err)
			h.writeErr(w, http.StatusInternalServerError, "internal", "could not prepare tools")
			return
		}
		defer ts.Close()
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), toolsetCtxKey, &ts)))
	})
}

func (h *Handlers) toolsetDeps() capload.APIToolsetDeps {
	return capload.APIToolsetDeps{Visitor: h.d.Visitor, Store: h.d.Keys, Skills: h.d.AgentSkills}
}

func keyFromCtx(ctx context.Context) *access.APIKey {
	k, ok := ctx.Value(keyCtxKey).(*access.APIKey)
	if !ok {
		return nil
	}
	return k
}

func toolsetFromCtx(ctx context.Context) *capload.APIToolset {
	t, ok := ctx.Value(toolsetCtxKey).(*capload.APIToolset)
	if !ok {
		return nil
	}
	return t
}

// rateVerdict —— per-key fixed-window limiter. Fail-open on Redis error (authenticated keys →
// availability over throttling, unlike login_guard which fails closed).
//
// 拒绝时**一并给出还要等多久**:那是这把计数键的剩余 TTL,即这个窗口真正还剩的时间。
// 调用方拿它填 `Retry-After`(F-K-2)—— 不给这个数,客户端只能猜,而猜的结果通常是立刻重试。
// 两个返回值类型不同(bool / Duration),所以不必起名 —— 起了反而撞 nonamedreturns。
// 计数那一段拆进 bumpWindow:面上的函数要守 cyclo ≤3,而"数一次"本来也是独立的一件事。
func (h *Handlers) rateVerdict(ctx context.Context, key *access.APIKey) (bool, time.Duration) {
	rkey := "ratelimit:apikey:" + key.ID
	n, counted := h.bumpWindow(ctx, rkey)
	if !counted {
		return true, 0 // fail-open：redis 抖不该把已认证的调用方挡在门外
	}
	if n <= int64(keyLimit(key, h.d.DefaultRPM)) {
		return true, 0
	}
	return false, h.windowLeft(ctx, rkey)
}

// bumpWindow —— 这个窗口内的第几次调用;第一次顺手把 TTL 装上。
// 第二个返回值是"数到了没有":redis 出错时返 false,由调用方决定放行(fail-open)。
func (h *Handlers) bumpWindow(ctx context.Context, rkey string) (int64, bool) {
	n, err := h.d.Redis.Incr(ctx, rkey).Result()
	if err != nil {
		h.d.Log.Warn("api key rate limit redis", "err", err)
		return 0, false
	}
	if n == 1 {
		h.setRateExpiry(ctx, rkey)
	}
	return n, true
}

// windowLeft —— 这把计数键还有多久过期。取不到(键刚好没了 / redis 抖)就退回整窗:
// 宁可让调用方多等一会儿,也**不要给一个 0** —— 0 的意思是"现在就可以重试",那是假话.
func (h *Handlers) windowLeft(ctx context.Context, rkey string) time.Duration {
	ttl, err := h.d.Redis.TTL(ctx, rkey).Result()
	if err != nil || ttl <= 0 {
		return rateWindow
	}
	return ttl
}

func (h *Handlers) setRateExpiry(ctx context.Context, rkey string) {
	if err := h.d.Redis.Expire(ctx, rkey, rateWindow).Err(); err != nil {
		h.d.Log.Warn("api key rate limit expire", "err", err)
	}
}

func keyLimit(key *access.APIKey, def int) int {
	if key.RateLimitRPM != nil && *key.RateLimitRPM > 0 {
		return int(*key.RateLimitRPM)
	}
	return def
}

// bearerSecret —— the raw secret from the Authorization header (empty if absent/malformed).
func bearerSecret(r *http.Request) string {
	const pfx = "Bearer "
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, pfx) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, pfx))
}

// errResp / writeErr / writeJSON —— user-friendly envelopes (no executor/provider internals).
type errResp struct {
	Reason string `json:"reason"`
	Detail string `json:"detail"`
}

func (h *Handlers) writeErr(w http.ResponseWriter, status int, reason, detail string) {
	h.writeJSON(w, status, errResp{Reason: reason, Detail: detail})
}

//nolint:forbidigo // json.Encoder.Encode 必须 interface{}; 集中此处放行（同 admin/helpers.go）。
func (h *Handlers) writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		h.d.Log.Warn("api write json", "err", err)
	}
}
