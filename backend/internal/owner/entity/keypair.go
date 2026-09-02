// keypair.go —— Phase C: Owner Ed25519 keypair domain value. The private key
// never enters the domain (owner keeps the PEM); this struct only carries
// the metadata the owner can see + the public key PEM the backend needs to
// verify signatures.
//
// Revoke = hard delete (no status field). Matches youteacher's minimalist style.

package entity

import (
	"errors"
	"time"
)

// ErrKeypairUnauthorized —— generic sigv1 verification failure (key not
// found / bad signature / timestamp outside window / malformed header).
// Caller translates to HTTP 401.
var ErrKeypairUnauthorized = errors.New("keypair: unauthorized")

// Keypair —— one DB row. PublicKeyPEM is PKCS8 Ed25519 encoded.
type Keypair struct {
	LastUsedAt   *time.Time
	CreatedAt    time.Time
	ID           string
	OwnerID      string
	KeyID        string
	PublicKeyPEM string
	Label        string
}

// KeypairMetadata —— for the admin list: drops PEM + ownerID, keeps only
// the fields the owner UI cares about. Never returns the public key (owner
// already downloaded the PEM and keeps it themselves; no need to see the
// server-side copy).
type KeypairMetadata struct {
	LastUsedAt *time.Time
	CreatedAt  time.Time
	ID         string
	KeyID      string
	Label      string
}
