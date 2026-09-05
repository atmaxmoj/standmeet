// owner_session.go —— Redis-backed session created after owner login.
//
// Session token: 32 random bytes, base64url, prefix `sms_`.
// Redis key: `session:{token}`, value is JSON-encoded ownerSessionData.
// Per-owner index: `owner_sessions:{ownerID}` is a SET of that owner's tokens, so
// the active-sessions panel can list them (a raw token is never exposed — each
// session carries a random public ID for the revoke button to target).
// TTL: 24h sliding window (each access refreshes expires_at + Redis TTL together).
// Revocation: DEL the key + SREM it from the owner index.
//
// The index set has no TTL of its own; a token that has expired out of Redis is
// pruned from the set the next time the owner's sessions are read (prune-on-read).
// ponytail: prune-on-read, fine for a handful of sessions per owner; add a sweep
// if an owner ever holds thousands.

package session

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	ownerTokenBytes    = 32
	ownerTokenPrefix   = "sms_"
	ownerSessionTTL    = 24 * time.Hour
	ownerSessionKeyPfx = "session:"
	ownerIndexKeyPfx   = "owner_sessions:"
	sessionIDBytes     = 12
	csrfTokenBytes     = 32
)

// ErrSessionNotFound —— this session isn't in Redis (expired or logged out).
var ErrSessionNotFound = errors.New("session not found")

// OwnerSessionData is the session payload stored in Redis.
// Field order is time.Time / string to satisfy fieldalignment.
type OwnerSessionData struct {
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
	OwnerID   string    `json:"owner_id"`
	CSRFToken string    `json:"csrf_token"`
	// ID —— a random public identifier for this session. The revoke button targets
	// this, never the raw token (which is the auth credential).
	ID        string `json:"id"`
	IPAddress string `json:"ip_address"`
	UserAgent string `json:"user_agent"`
}

// IssuedSession bundles the plaintext token + session data that Issue
// returns, so the function returns at most 2 values.
type IssuedSession struct {
	Token string
	Data  OwnerSessionData
}

// tokenData pairs a live session's raw token with its data, for the internal
// iterators that need both (revoke needs the token; the panel needs the data).
type tokenData struct {
	token string
	data  OwnerSessionData
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

// Issue issues a new session, capturing the client IP + user agent so the
// active-sessions panel can show where each login came from. The returned
// IssuedSession holds the plaintext token (caller writes it as a cookie) and
// SessionData (including csrf_token, returned by GET /csrf).
func (s *OwnerSessionStore) Issue(
	ctx context.Context, ownerID, ipAddress, userAgent string,
) (IssuedSession, error) {
	tok, err := genSessionTokens()
	if err != nil {
		return IssuedSession{}, err
	}
	now := time.Now()
	data := OwnerSessionData{
		OwnerID:   ownerID,
		CSRFToken: tok.csrf,
		ID:        tok.id,
		IPAddress: ipAddress,
		UserAgent: userAgent,
		CreatedAt: now,
		ExpiresAt: now.Add(ownerSessionTTL),
	}
	if perr := s.persist(ctx, tok.token, &data); perr != nil {
		return IssuedSession{}, perr
	}
	if serr := s.rdb.SAdd(ctx, ownerIndexKeyPfx+ownerID, tok.token).Err(); serr != nil {
		return IssuedSession{}, fmt.Errorf("index session: %w", serr)
	}
	return IssuedSession{Token: tok.token, Data: data}, nil
}

// Get reads the session and slides the TTL (resets to 24h). Returns
// ErrSessionNotFound if the session doesn't exist.
func (s *OwnerSessionStore) Get(ctx context.Context, token string) (OwnerSessionData, error) {
	data, err := s.getRaw(ctx, token)
	if err != nil {
		return OwnerSessionData{}, err
	}
	data.ExpiresAt = time.Now().Add(ownerSessionTTL)
	if perr := s.persist(ctx, token, &data); perr != nil {
		return OwnerSessionData{}, perr
	}
	return data, nil
}

// ListByOwner returns all of an owner's live sessions, newest first. Tokens that
// have expired out of Redis are pruned from the index as they're found.
func (s *OwnerSessionStore) ListByOwner(
	ctx context.Context, ownerID string,
) ([]OwnerSessionData, error) {
	live, err := s.liveSessions(ctx, ownerID)
	if err != nil {
		return nil, err
	}
	out := make([]OwnerSessionData, 0, len(live))
	for i := range live {
		out = append(out, live[i].data)
	}
	slices.SortFunc(out, func(a, b OwnerSessionData) int {
		return b.CreatedAt.Compare(a.CreatedAt) // newest first
	})
	return out, nil
}

// Revoke deletes the session (logout) and drops it from the owner index. A
// nonexistent token counts as success (idempotent).
func (s *OwnerSessionStore) Revoke(ctx context.Context, token string) error {
	if data, gerr := s.getRaw(ctx, token); gerr == nil {
		s.rdb.SRem(ctx, ownerIndexKeyPfx+data.OwnerID, token)
	}
	if err := s.rdb.Del(ctx, ownerSessionKeyPfx+token).Err(); err != nil {
		return fmt.Errorf("redis del session: %w", err)
	}
	return nil
}

// RevokeByID revokes the owner's session with the given public ID (the panel's
// per-session sign-out). Scoped to ownerID: an owner can only ever name their own
// sessions. Returns ErrSessionNotFound if no live session has that ID.
func (s *OwnerSessionStore) RevokeByID(ctx context.Context, ownerID, id string) error {
	live, err := s.liveSessions(ctx, ownerID)
	if err != nil {
		return err
	}
	for i := range live {
		if live[i].data.ID == id {
			return s.Revoke(ctx, live[i].token)
		}
	}
	return ErrSessionNotFound
}

// liveSessions reads the owner's index and returns each token still present in
// Redis, pruning any that have expired out. Shared by ListByOwner + RevokeByID.
func (s *OwnerSessionStore) liveSessions(
	ctx context.Context, ownerID string,
) ([]tokenData, error) {
	tokens, err := s.rdb.SMembers(ctx, ownerIndexKeyPfx+ownerID).Result()
	if err != nil {
		return nil, fmt.Errorf("redis smembers sessions: %w", err)
	}
	out := make([]tokenData, 0, len(tokens))
	for _, token := range tokens {
		data, gerr := s.getRaw(ctx, token)
		if errors.Is(gerr, ErrSessionNotFound) {
			s.rdb.SRem(ctx, ownerIndexKeyPfx+ownerID, token) // prune expired
			continue
		}
		if gerr != nil {
			return nil, gerr
		}
		out = append(out, tokenData{token: token, data: data})
	}
	return out, nil
}

// getRaw reads the session without sliding the TTL — used by the iterators, which
// must not refresh every one of an owner's sessions just because they were listed.
func (s *OwnerSessionStore) getRaw(ctx context.Context, token string) (OwnerSessionData, error) {
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
	return data, nil
}

func (s *OwnerSessionStore) persist(
	ctx context.Context, token string, data *OwnerSessionData,
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

// sessionTokens bundles the three random strings Issue needs.
type sessionTokens struct{ token, csrf, id string }

// genSessionTokens mints the session token, its csrf token, and the public id.
func genSessionTokens() (sessionTokens, error) {
	token, err := randomToken(ownerTokenBytes, ownerTokenPrefix)
	if err != nil {
		return sessionTokens{}, fmt.Errorf("gen session token: %w", err)
	}
	csrf, err := randomToken(csrfTokenBytes, "")
	if err != nil {
		return sessionTokens{}, fmt.Errorf("gen csrf token: %w", err)
	}
	id, err := randomToken(sessionIDBytes, "")
	if err != nil {
		return sessionTokens{}, fmt.Errorf("gen session id: %w", err)
	}
	return sessionTokens{token: token, csrf: csrf, id: id}, nil
}

func randomToken(byteLen int, prefix string) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buf), nil
}
