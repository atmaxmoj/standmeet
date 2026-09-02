package entity

import (
	"errors"
	"strings"
	"time"
)

// Embed — one embed widget configuration. **An embed points at a code**: it is the
// outward-facing config that wraps a code, referencing the code it exposes and adding an
// origin restriction on top. The owner manages it under Access and gets a copy-paste
// snippet to drop onto someone else's site (embed plan 2026-09-01).
type Embed struct {
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ID             string
	OwnerID        string
	CodeID         string
	Label          string
	KeyID          string
	PublicKey      string
	AllowedOrigins []string
}

// EmbedCreated — the result of creating an embed: the embed itself + the private key PEM,
// which is **returned only this once**. The private key goes into the widget's JS
// (not the code); the server keeps only the public key.
type EmbedCreated struct {
	PrivateKey string
	Embed      Embed
}

// EmbedAuth — the set looked up by a JWT's kid: the verification public key + origin
// allowlist + the code it exposes. The plaintext code is available server-side only at
// this step, during session issuance.
type EmbedAuth struct {
	PublicKey      string
	Code           string
	AllowedOrigins []string
}

// OriginAllowed — the same check on the EmbedAuth side (the same rules as Embed.OriginAllowed).
func (a *EmbedAuth) OriginAllowed(origin string) bool {
	e := Embed{AllowedOrigins: a.AllowedOrigins}
	return e.OriginAllowed(origin)
}

// ErrEmbedNotFound — this row is not in the embed ledger (bad id, or not owned by this owner).
var ErrEmbedNotFound = errors.New("embed not found")

// ErrEmbedOriginNotAllowed — this embed code is not permitted to be used from this origin (403).
var ErrEmbedOriginNotAllowed = errors.New("embed origin not allowed")

// ErrCodeAlreadyEmbedded — this code is already exposed by an embed (code_id is unique). A
// code can carry only one origin allowlist — attaching a second embed would create a second
// allowlist, and which one wins would be undefined. Wanting a second one means issuing a
// second code.
var ErrCodeAlreadyEmbedded = errors.New("code already exposed by an embed")

// ErrPeriodLimitReached — this code has used up its quota for the current period (403,
// refillable).
var ErrPeriodLimitReached = errors.New("period limit reached")

// ErrEmbedTokenInvalid — the embed's JWT credential failed validation (bad signature /
// expired / replayed / wrong alg / unknown kid / origin mismatch with the header). One
// sentinel, not broken down by which step failed — this avoids handing an attacker a
// probing oracle (401).
var ErrEmbedTokenInvalid = errors.New("embed token invalid")

// OriginAllowed — whether an origin may use this embed.
//
//   - AllowedOrigins empty = unrestricted, any origin passes (today's behavior).
//   - Non-empty = origin must exactly match one entry in the list. An empty origin (no
//     Origin header sent) is always rejected once restricted: a restricted embed has no
//     reason to admit a request that cannot even report where it came from.
//
// Exact match (scheme+host+port all equal), no subdomain / wildcard — an embed's origin
// set is explicitly listed by the owner, and wildcarding would silently widen "only for
// alice.example" into "for all of *.example".
func (e *Embed) OriginAllowed(origin string) bool {
	if len(e.AllowedOrigins) == 0 {
		return true
	}
	got := strings.TrimRight(strings.TrimSpace(origin), "/")
	if got == "" {
		return false
	}
	for _, a := range e.AllowedOrigins {
		if strings.TrimRight(strings.TrimSpace(a), "/") == got {
			return true
		}
	}
	return false
}
