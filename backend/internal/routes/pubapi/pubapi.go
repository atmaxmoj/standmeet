// Package pubapi —— the API-key facade (facade-directions.md): the outward, non-agentic,
// role-scoped programmatic surface at /api/pub/v1. A holder presents `Authorization: Bearer smk_…`;
// the key resolves to a role snapshot (exactly like an access code, minus the LLM and the gas), and
// its HTTP calls dispatch through the SAME capreg assembly the visitor chat tools use — so ACL /
// denial / quota / connector-gate behavior is identical to code by construction. On top of assembly
// the facade adds candidacy (the owner must have "opened" the capability) and the api whitelist
// (only non-Agentic outward tools render). Bounded by rate limiting, not gas.
//
// Handlers stay presentation-only (cyclo ≤3): auth + rate + assembly run as middleware and stash
// their results in context; the branchy toolset assembly lives in usecases.AssembleAPIKeyToolset.
package pubapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/conversation"
	"github.com/atmaxmoj/standmeet/internal/infra/paritymanifest"
	"github.com/atmaxmoj/standmeet/internal/usecases"
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
	usecases.APIToolsetStore
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
		if !h.allowRate(r.Context(), &key) {
			h.writeErr(w, http.StatusTooManyRequests, "rate_limited", "rate limit exceeded")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), keyCtxKey, &key)))
	})
}

// assemble —— freeze the key's toolset (grant ∩ opened ∩ whitelist) into context for the handlers.
func (h *Handlers) assemble(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := keyFromCtx(r.Context())
		ts, err := usecases.AssembleAPIKeyToolset(
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

func (h *Handlers) toolsetDeps() usecases.APIToolsetDeps {
	return usecases.APIToolsetDeps{Visitor: h.d.Visitor, Store: h.d.Keys, Skills: h.d.AgentSkills}
}

func keyFromCtx(ctx context.Context) *access.APIKey {
	k, ok := ctx.Value(keyCtxKey).(*access.APIKey)
	if !ok {
		return nil
	}
	return k
}

func toolsetFromCtx(ctx context.Context) *usecases.APIToolset {
	t, ok := ctx.Value(toolsetCtxKey).(*usecases.APIToolset)
	if !ok {
		return nil
	}
	return t
}

// allowRate —— per-key fixed-window limiter. Fail-open on Redis error (authenticated keys →
// availability over throttling, unlike login_guard which fails closed).
func (h *Handlers) allowRate(ctx context.Context, key *access.APIKey) bool {
	rkey := "ratelimit:apikey:" + key.ID
	n, err := h.d.Redis.Incr(ctx, rkey).Result()
	if err != nil {
		h.d.Log.Warn("api key rate limit redis", "err", err)
		return true
	}
	if n == 1 {
		h.setRateExpiry(ctx, rkey)
	}
	return n <= int64(keyLimit(key, h.d.DefaultRPM))
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
