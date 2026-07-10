package domain

import (
	"errors"
	"time"
)

// ErrAPIKeyNotFound —— no active/unexpired key resolves for the given secret or id.
var ErrAPIKeyNotFound = errors.New("api key not found")

// APIKey —— an issued programmatic credential (facade-directions.md). Assumes a role exactly like
// an access code; its holder calls capabilities as HTTP endpoints (no LLM, no gas), rate-limited.
// SecretHash is the sha256 of the full `smk_…` secret; the raw secret is shown once at mint and
// never persisted.
type APIKey struct {
	CreatedAt     time.Time
	LastUsedAt    *time.Time
	ExpiresAt     *time.Time
	RateLimitRPM  *int32
	MaxBookings   *int32
	ID            string
	OwnerID       string
	AssumedRoleID string
	Label         string
	Prefix        string
	Status        string
	SecretHash    []byte
}

// CreateAPIKeyInput —— mint a key. The caller hashes the freshly-generated secret and keeps the raw
// value only to return it once; the store never sees the raw secret.
type CreateAPIKeyInput struct {
	ExpiresAt     *time.Time
	RateLimitRPM  *int32
	MaxBookings   *int32
	OwnerID       string
	AssumedRoleID string
	Label         string
	Prefix        string
	SecretHash    []byte
}

// UpdateAPIKeyInput —— partial update. Label updates when non-nil; the rate/bookings quotas update
// only when their Set flag is true (so a nil-with-Set clears to "instance default"/"unlimited").
type UpdateAPIKeyInput struct {
	Label        *string
	RateLimitRPM *int32
	MaxBookings  *int32
	ID           string
	OwnerID      string
	SetRate      bool
	SetBookings  bool
}
