// access_code.go — the visitor access code (aggregate root) + its CodeMember child entity.
// Revoke happens only at the code level (status='revoked'); a single member cannot be revoked
// on its own — that complexity is not worth it.

package entity

import (
	"errors"
	"time"
)

// Code — a visitor access code.
//
//   - MaxMembers nil -> unlimited; how many distinct names this code can hold (member = one
//     person = one continuing chat). Once full, a new name is rejected (visitor sees "code is
//     full"); an existing name may continue.
//   - MaxTurnsPerSession   nil -> unlimited; the visitor-turn cap within a single session.
//   - Status is 'active' / 'revoked' (expiry is computed from ExpiresAt, not a written
//     status field).
//   - AssumedRoleID is required and points at one of the owner's roles rows; session issue
//     freezes it into a [[role_snapshot]]. If the owner does not pick one explicitly, the
//     usecase defaults to public.
//
// #135: per-code booking quota is not in the kernel — the booker capability owns it
// (its own capstore), the kernel does not know about it.
type Code struct {
	CreatedAt            time.Time
	ExpiresAt            *time.Time
	MaxMembers           *int32
	MaxTurnsPerSession   *int32
	RequireGhostEvidence *bool
	PromptID             *string
	LimitPerPeriod       *PeriodLimit
	Code                 string
	OwnerID              string
	Label                string
	Purpose              string
	Status               string
	AssumedRoleID        string
	InlinePrompt         string
	CustomPageSlug       string
	ProviderID           string
	ID                   string
	Ghosts               []string
}

// PeriodLimit — how much a code may spend per period (a refillable rate gate).
// max_turns_per_session is per-session, gas is a total; this one is a bucket that
// **auto-refills every period**. A public embed code uses it to guard against abuse.
type PeriodLimit struct {
	// Unit — 'turns' or 'gas'. turns counts dialog entries, gas counts token usage.
	Unit          string `json:"unit"`
	Amount        int64  `json:"amount"`
	PeriodSeconds int64  `json:"period_seconds"`
}

// TurnsWindow — the two numbers of a valid turns gate: the quota + the rolling window in seconds.
type TurnsWindow struct {
	Amount        int64
	PeriodSeconds int64
}

// TurnsCap — returns *TurnsWindow if this is a valid turns gate; otherwise nil (not set /
// not turns / bad values). A nil receiver is safe (no gate set just means no gate set).
// A pointer instead of an (amount, period, ok) triple: the return count stays at 2, and a
// nil pointer already says "is there one or not" (the same tradeoff as EmbedForCode).
func (p *PeriodLimit) TurnsCap() *TurnsWindow {
	if p == nil || p.Unit != "turns" || p.Amount <= 0 || p.PeriodSeconds <= 0 {
		return nil
	}
	return &TurnsWindow{Amount: p.Amount, PeriodSeconds: p.PeriodSeconds}
}

// CreateAccessCodeInput — input for creating an access code (domain-level, used by the MCP
// cap + any downstream writer of Code). access.CreateCodeInput is a repo-local mirror;
// CodeRepo.CreateAccessCode converts this type into that one.
type CreateAccessCodeInput struct {
	ExpiresAt          *time.Time
	MaxMembers         *int32
	MaxTurnsPerSession *int32
	PromptID           *string
	OwnerID            string
	Code               string
	Label              string
	Purpose            string
	AssumedRoleID      string
	InlinePrompt       string
	// ProviderID —— the provider this code specifies (empty = inherit from role, then default).
	ProviderID string
	Ghosts     []string
}

// CodeMember — one named visitor under an access code (a child entity of the Code aggregate).
// The same code + the same display_name is a unique row. Revoke happens only at the Code
// level (code.status='revoked'), never for a single member — that complexity is not worth it.
type CodeMember struct {
	LastSeenAt  time.Time
	ID          string
	CodeID      string
	DisplayName string
	Email       string
	IsAnonymous bool
}

// CodeStatusActive / CodeStatusRevoked —— the vocabulary for access_codes.status (matches the
// schema CHECK constraint).
const (
	CodeStatusActive  = "active"
	CodeStatusRevoked = "revoked"
)

// ErrCodeInvalid — this access code **does not exist**.
//
// It used to also mean "revoked", which forced the visitor-facing refusal to read
// "invalid or revoked" — but the two callers need opposite next steps: a typo should be
// re-pasted, a revocation should be replaced with a new code (F-D-6). Revoked is now
// ErrCodeRevoked.
var ErrCodeInvalid = errors.New("access code invalid")

// ErrCodeRevoked — this access code exists, but the owner revoked it.
var ErrCodeRevoked = errors.New("access code revoked")

// ErrCodeTaken — the code string is already taken (access_codes.code is unique).
var ErrCodeTaken = errors.New("access code already exists")

// ErrCodeExpired — the access code has expired.
var ErrCodeExpired = errors.New("access code expired")

// ErrMemberQuotaReached — this code's member (distinct-name) count is at max_members, a new
// name is rejected.
var ErrMemberQuotaReached = errors.New("member quota reached for code")

// ErrMemberNotFound — looking up a member by id found nothing (a client-stored member_id
// went stale).
var ErrMemberNotFound = errors.New("code member not found")

// ErrDenialKindUnknown — a denial's kind is none of capability / skill / corpus.
var ErrDenialKindUnknown = errors.New("denial kind must be capability, skill or corpus")

// ErrTurnQuotaReached — this session has used up its max_turns_per_session.
var ErrTurnQuotaReached = errors.New("turn quota reached for session")

// ErrGasExhausted — the gas tank attached to this session ran dry (#7). It's the same class
// as running out of turns: not an error, just "cannot send this time", so it also goes
// through 403 + a human-readable message instead of a 5xx.
var ErrGasExhausted = errors.New("provider gas exhausted")
