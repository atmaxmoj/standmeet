// Package security —— the request-level **protection** domain (separate from access's
// "authentication": authentication asks "who are you, can you get in"; protection asks
// "should this origin be blocked").
//
// This package (internal/security/facade) is security's **external facade**: a thin shell
// that just re-exports the internal subpackages' types/constructors + codedoc. See the whole
// protocol at a glance; other layers only import this facade package and only use the symbols
// here. The real implementation lives in sibling subpackages internal/security/{ban,captcha};
// check-domain-facade-boundary blocks direct external references (outside the domain, only
// .../security/facade may be imported).
//
// # External protocol
//
// IP bans (owner bans a source IP; a hit on the public surface returns 403):
//   - NewBannedIPRepo(pool) *BannedIPRepo —— constructs the repo
//   - (*BannedIPRepo) Ban / List / Unban / IsBanned / IsBannedAnywhere
//   - BannedIP (one ban; Active() reports whether it's in effect right now) ·
//     BanIPInput (Ban's input)
//
// captcha human verification (before login/code send; Cloudflare Turnstile or noop=off):
//   - NewFromConfig(cfg, httpClient) Verifier —— assembles a verifier per cfg
//   - Verifier.Verify(ctx, token, remoteIP) error —— nil=allow, error=reject
//   - Config / Provider(ProviderNone|ProviderTurnstile) · FromEnvLike(siteKey, secret) Config
//   - ErrCaptchaFailed —— sentinel for verification failure
//
// New protection capability (e.g. replay defense): implement in a sibling subpackage,
// add one forwarding line + codedoc here.
package security

import (
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/security/ban"
)

// ── IP bans (impl: ban subpackage) ────────────────────────────────

// BannedIP —— one source IP the owner banned; Active() reports whether it's in effect right now.
type BannedIP = ban.BannedIP

// BannedIPRepo —— banned_ips table repo (Ban/List/Unban/IsBanned/IsBannedAnywhere).
type BannedIPRepo = ban.BannedIPRepo

// BanIPInput —— Ban's input.
type BanIPInput = ban.IPInput

// NewBannedIPRepo —— constructs the banned_ips repo.
func NewBannedIPRepo(pool *pgstore.Pool) *BannedIPRepo { return ban.NewBannedIPRepo(pool) }
