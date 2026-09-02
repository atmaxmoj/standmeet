// instance.go —— domain view of the singleton "this deployment" row.
// One self-hosted instance maps to one instance_settings row; under
// multi-tenant, one row per tenant.

package entity

import (
	"errors"
	"time"
)

// InstanceSettings is a snapshot of the singleton row.
type InstanceSettings struct {
	DeployedAt time.Time
	// SetupTokenHash —— the actual hash stored in the DB (empty string if
	// there is none). **A bool alone is not enough**: the side that sent
	// the link holds the plaintext, and what needs checking is "does this
	// plaintext, hashed, equal what's in the DB". Asking only "is there
	// one" can't distinguish "fine" from "the two halves each have their
	// own copy" — and the latter is exactly the state that, in the real
	// environment, leaves the owner permanently unable to claim (F-L-56).
	SetupTokenHash string
	// The three bools go last: fieldalignment wants larger fields first,
	// don't burn an extra word just for readability.
	IsClaimed         bool
	MultiTenant       bool
	HasSetupTokenHash bool // whether setup_token_hash is non-NULL in DB (cleared on claim)
}

// ErrInstanceAlreadyClaimed —— attempted to claim the same instance again
// (initial setup already happened).
var ErrInstanceAlreadyClaimed = errors.New("instance already claimed")

// ErrInvalidSetupToken —— setup token doesn't match (tampered, stolen,
// expired / already consumed).
var ErrInvalidSetupToken = errors.New("invalid setup token")

// ErrInstanceSettingsNotFound —— the single instance_settings row wasn't
// found (shouldn't happen in v1 since migration seeds it; kept as a
// sentinel for future multi-tenant use).
var ErrInstanceSettingsNotFound = errors.New("instance settings not found")
