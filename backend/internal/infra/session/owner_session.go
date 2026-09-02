// owner_session.go —— Redis-backed session created after owner login.
//
// Session token: 32 random bytes, base64url, prefix `sms_`.
// Redis key: `session:{token}`, value is JSON-encoded ownerSessionData.
// TTL: 24h sliding window (each access refreshes expires_at + Redis TTL
// together).
// Revocation: just DEL the key.

package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	ownerTokenBytes    = 32
	ownerTokenPrefix   = "sms_"
	ownerSessionTTL    = 24 * time.Hour
	ownerSessionKeyPfx = "session:"
	csrfTokenBytes     = 32
)

// ErrSessionNotFound —— this session isn't in Redis (expired or logged out).
var ErrSessionNotFound = errors.New("session not found")

// OwnerSessionData is the session payload stored in Redis.
// Field order is time.Time / string / string to satisfy fieldalignment.
type OwnerSessionData struct {
	ExpiresAt time.Time `json:"expires_at"`
	OwnerID   string    `json:"owner_id"`
	CSRFToken string    `json:"csrf_token"`
}

// IssuedSession bundles the plaintext token + session data that Issue
// returns, so the function returns at most 2 values.
type IssuedSession struct {
	Token string
	Data  OwnerSessionData
}

// OwnerSessionStore wraps a Redis client to provide session CRUD. No
// business logic.
type OwnerSessionStore struct {
	rdb *redis.Client
}

// NewOwnerSessionStore constructs a store.
func NewOwnerSessionStore(rdb *redis.Client) *OwnerSessionStore {
	return &OwnerSessionStore{rdb: rdb}
}

// Issue issues a new session. The returned IssuedSession holds the
// plaintext token (caller writes it as a cookie) and SessionData
// (including csrf_token, returned by GET /csrf).
func (s *OwnerSessionStore) Issue(ctx context.Context, ownerID string) (IssuedSession, error) {
	token, err := randomToken(ownerTokenBytes, ownerTokenPrefix)
	if err != nil {
		return IssuedSession{}, fmt.Errorf("gen session token: %w", err)
	}
	csrf, err := randomToken(csrfTokenBytes, "")
	if err != nil {
		return IssuedSession{}, fmt.Errorf("gen csrf token: %w", err)
	}

	data := OwnerSessionData{
		OwnerID:   ownerID,
		CSRFToken: csrf,
		ExpiresAt: time.Now().Add(ownerSessionTTL),
	}
	if perr := s.persist(ctx, token, data); perr != nil {
		return IssuedSession{}, perr
	}
	return IssuedSession{Token: token, Data: data}, nil
}

// Get reads the session and slides the TTL (resets to 24h). Returns
// ErrSessionNotFound if the session doesn't exist.
func (s *OwnerSessionStore) Get(ctx context.Context, token string) (OwnerSessionData, error) {
	raw, err := s.rdb.Get(ctx, ownerSessionKeyPfx+token).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return OwnerSessionData{}, ErrSessionNotFound
		}
		return OwnerSessionData{}, fmt.Errorf("redis get session: %w", err)
	}
	var data OwnerSessionData
	if uerr := json.Unmarshal(raw, &data); uerr != nil {
		return OwnerSessionData{}, fmt.Errorf("decode session: %w", uerr)
	}
	data.ExpiresAt = time.Now().Add(ownerSessionTTL)
	if perr := s.persist(ctx, token, data); perr != nil {
		return OwnerSessionData{}, perr
	}
	return data, nil
}

// Revoke deletes the session (logout). A nonexistent token counts as
// success (idempotent).
func (s *OwnerSessionStore) Revoke(ctx context.Context, token string) error {
	if err := s.rdb.Del(ctx, ownerSessionKeyPfx+token).Err(); err != nil {
		return fmt.Errorf("redis del session: %w", err)
	}
	return nil
}

func (s *OwnerSessionStore) persist(
	ctx context.Context, token string, data OwnerSessionData,
) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("encode session: %w", err)
	}
	key := ownerSessionKeyPfx + token
	if serr := s.rdb.Set(ctx, key, payload, ownerSessionTTL).Err(); serr != nil {
		return fmt.Errorf("redis set session: %w", serr)
	}
	return nil
}

func randomToken(byteLen int, prefix string) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buf), nil
}
