package entity

import (
	"errors"
	"time"
)

// Owner is the root of the owner aggregate. Holds only "identity" fields —
// email / handle / name / location / created-at. The various settings
// live outside this struct, carried by the Settings aggregate's internal
// value objects (AI provider / BYOAI / domain, etc).
//
// Field order follows govet fieldalignment: time.Time first (internal ptr
// at 16); strings grouped after.
type Owner struct {
	CreatedAt time.Time
	ID        string
	Email     string
	Handle    string
	FullName  string
	Location  string
	// PublicURL —— the full outward-facing URL (scheme+host+port). Required
	// at claim time, editable in admin. SEO canonical / QR URL both read
	// from this column, no env / no fallback / no default.
	PublicURL string
	// ProfileTimezone —— IANA tz name ('America/New_York' / 'Asia/Shanghai').
	// Used by BookingPolicy / calendar.book to interpret working_hours /
	// weekday; empty string falls back to UTC. Owner edits it in admin
	// profile.
	ProfileTimezone string
	// PendingEmail —— a requested new email that **hasn't yet been proven
	// reachable**. Empty string = no pending change. It isn't identity:
	// login and the recovery phrase still key off the Email column. The
	// panel must show it — an invisible pending state means the owner
	// doesn't know whether the button they clicked actually took effect.
	PendingEmail string
}

// Settings —— the owner aggregate's "config facet", separate from
// identity. Three independent setting groups: AI / BYOAI / Domain; future
// additions like connector / SEO config also belong here.
//
// This is a value object of the Owner aggregate (not its own aggregate
// root), and travels with Owner across the transaction boundary — saving
// the AI key and saving BYOAI each land in the DB separately, but both go
// through Repo.
type Settings struct {
	AI    AISettings
	BYOAI BYOAISettings
}

// AISettings —— the owner's own inference provider config (used for real
// visitor chat); the plaintext key never leaves the repo, the outer layer
// only sees the KeyConfigured bool.
type AISettings struct {
	Provider      string // 'anthropic' | 'openai' | 'custom' | ...
	Endpoint      string // base URL the owner explicitly set (SoT; empty = use preset default)
	Model         string // model the owner explicitly set (SoT; empty = use preset default)
	KeyConfigured bool
}

// BYOAISettings —— the "visitor brings their own key" mode toggle + the
// list of allowed providers + the explanation text shown to visitors.
type BYOAISettings struct {
	PublicBlurb string
	Providers   []string
	Enabled     bool
}

// CreateOwnerInput is the creation parameter the usecase layer passes to
// Repository. PasswordHash is already hashed (usecase calls the hasher),
// Repository never touches the plaintext. PublicURL is the full
// outward-facing URL (scheme + host + optional port), required at claim
// time; SEO canonical / QR URL both read from owner.PublicURL, no env
// fallback.
type CreateOwnerInput struct {
	Email        string
	PasswordHash string
	Handle       string
	FullName     string
	PublicURL    string
}

// Owner-scoped sentinel errors. Sentinels for other aggregates live in
// their own files.
var (
	// ErrEmailTaken —— email already in use at claim time (shouldn't happen
	// in v1 but kept as a guard).
	ErrEmailTaken = errors.New("email already taken")
	// ErrPendingEmailNotFound —— the confirmation link doesn't match any
	// pending change: wrong token, expired, or already used. The three
	// cases are **deliberately** collapsed into one error — for someone
	// who doesn't know this token, distinguishing them would only tell
	// them whether their guess was right. Telling "expired" apart goes
	// through a different path (FindByPendingToken), one open only to
	// someone whose token genuinely exists.
	ErrPendingEmailNotFound = errors.New("pending email change not found")
	// ErrHandleTaken —— handle already in use at claim time.
	ErrHandleTaken = errors.New("handle already taken")
	// ErrOwnerNotFound —— lookup by id / email found no owner (login
	// doesn't reveal "does this user exist").
	ErrOwnerNotFound = errors.New("owner not found")
	// ErrUnauthorized —— auth failure (wrong password, dead session, bad
	// token, etc), the unified external code.
	ErrUnauthorized = errors.New("unauthorized")
	// ErrPublicURLNotSet —— owners.public_url is empty. Already required
	// at claim time; this guards against edge cases slipping through
	// (admin cleared it to an empty string, old data, etc). Caller should
	// direct the owner to /admin to fill it in and retry.
	ErrPublicURLNotSet = errors.New("public_url not set for owner")
	// ErrProviderNotFound —— no such entry in the provider list (bad id,
	// or it doesn't belong to this owner). Also used for "this owner has
	// no providers at all": nothing left to fall back to when the
	// resolution chain drops to the default tier.
	ErrProviderNotFound = errors.New("provider not found")
	// ErrProviderIsDefault —— trying to delete the default entry. Deleting
	// it would leave nothing to fall back to, so it's blocked; the owner
	// must either move the default to another entry first, or keep this
	// one.
	ErrProviderIsDefault = errors.New("provider is the default")
)
