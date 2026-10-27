// guards.go —— rate-limit / lockout ports for the public routes. Both implementations live in
// internal/infra/middleware and are injected in; the route layer never imports middleware.

package public

import "context"

// PubSearchGuard —— rate-limit port for public-tier tool calls (#public-corpus-search). impl =
// middleware.PubSearchGuard, injected in. Allow=false means over the per-IP cap → 429.
type PubSearchGuard interface {
	Allow(ctx context.Context, ip string) bool
}

// TurnGuard —— per-IP daily cap on owner-paid PUBLIC turns, so one anonymous visitor can't drain
// the owner's gas tank. impl = middleware.PublicTurnGuard, injected in. OverLimit=true means the IP
// passed its daily public-turn cap → the reader's page falls to BYOAI (their own key).
type TurnGuard interface {
	OverLimit(ctx context.Context, ip string) bool
}

// CodeGuard —— lockout port for failed access-code redemption (#169). impl =
// middleware.CodeGuard, injected in.
type CodeGuard interface {
	Locked(ctx context.Context, ip, captchaToken string) bool
	// HasLift —— true only when captcha is enabled; the rejection message's wording
	// follows this, else it'd describe a control that isn't on the screen.
	HasLift() bool
	RecordFail(ctx context.Context, ip string)
	Reset(ctx context.Context, ip string)
}
