// visitor_session.go — Redis storage for visitor sessions (code-tier or byoai).
//
// Token: 32 random bytes, base64url, prefixed `smv_`.
// Redis key: `vsession:{token}`, value is JSON-encoded visitorSessionData.
// TTL: slides 60min, max 8h (this simplified version only slides 60min; the max
// comes later).
// Revocation: DEL the key.

package usecase

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
	"github.com/redis/go-redis/v9"
)

const (
	visitorTokenBytes    = 32
	visitorTokenPrefix   = "smv_"
	visitorSessionTTL    = 60 * time.Minute
	visitorSessionKeyPfx = "vsession:"
	codeSessionsKeyPfx   = "vsessions:code:"
)

// ErrVisitorSessionNotFound — no such session in Redis (expired or revoked).
var ErrVisitorSessionNotFound = errors.New("visitor session not found")

// VisitorSessionData — the visitor session payload stored in Redis.
//
// Admission fields:
//   - Mode: 'code' / 'public' / 'byoai'. All three mandatorily carry a RoleSnapshot
//     (since A.3-IAM-5, ACL runs entirely through [[role_snapshot]].AllowsCorpus
//     URI-glob). public / byoai use the owner's public role; code uses
//     access_code.assumed_role_id.
//   - RoleSnapshot: frozen out of the role's full state at session-issue time
//     (corpus URIs / prompt / skills / mcp). The session never reads the role row
//     back again for its whole lifetime — the only remedy is revoking the code.
//
// **Does not store** the BYOAI provider + key — both are kept in one place, the
// browser (an encrypted vault in localStorage). On every chat, the visitor carries
// the provider name + an enveloped key in the `X-BYOAI-Provider` + `X-BYOAI-Key`
// headers; the server unseals with AES-GCM derived via HKDF(session_token), uses it
// once, and discards it.
// Centralized storage lives in one place, the browser — not spread across sessions.
type VisitorSessionData struct {
	// **No capability-specific quota lives here.** There used to be a
	// `MaxBookings *int32` — booker's per-code limit — written into the visitor
	// session payload. It ended up sitting here unwritten and unread: the column
	// on the code was long gone (see the generic CodeExtras in
	// access/ops/extras.go), but the field itself stayed. A capability that
	// needs a field on the code declares it via the manifest's CodeConfig, it
	// does not live on this struct.
	ExpiresAt    time.Time            `json:"expires_at"`
	RoleSnapshot *entity.RoleSnapshot `json:"role_snapshot"`
	OwnerID      string               `json:"owner_id"`
	Mode         string               `json:"mode"`
	CodeID       string               `json:"code_id"`
	MemberID     string               `json:"member_id"`
	// ProviderID — which provider from the owner's book this session uses. Empty
	// = the default one. **Resolved once at session-issue time and frozen**
	// (code > role > default), same model as RoleSnapshot: if the owner changes
	// the config mid-session, this session still goes by the state at the
	// moment the visitor came in.
	// (If the provider it points to is later deleted → falls back to default on
	// lookup, that's the provider book's own rule.)
	ProviderID string `json:"provider_id,omitempty"`
	// Visitor — the visitor's self-declared identity (name + optional email).
	// Carried on the session (a visitor's identity), not on the chat. booker
	// falls back to Email as visitor_email.
	Visitor entity.VisitorProfile `json:"visitor"`
	// VisitedWaypoints — the ghost-steering waypoint ledger: the set of visited
	// waypoint_ids (a reference hitting evidence_refs / a booking hitting a
	// terminal → added). ghost policy only nudges toward unvisited ones; all
	// visited = destination reached. A mechanical marker, no LLM judge (α≈0).
	VisitedWaypoints []string `json:"visited_waypoints,omitempty"`
	// GasMetered — whether this session carries the gas meter (a switch on the
	// role, likewise frozen at issue time). false = never issues a gas query.
	GasMetered bool `json:"gas_metered,omitempty"`
}

// VisitorSessionStore wraps Redis to provide visitor session CRUD.
type VisitorSessionStore struct {
	rdb *redis.Client
}

// NewVisitorSessionStore constructs the store.
func NewVisitorSessionStore(rdb *redis.Client) *VisitorSessionStore {
	return &VisitorSessionStore{rdb: rdb}
}

// IssuedVisitor — Issue's return value (plaintext token + data).
type IssuedVisitor struct {
	Token string
	Data  VisitorSessionData
}

// Issue mints a new visitor session.
func (s *VisitorSessionStore) Issue(
	ctx context.Context, data *VisitorSessionData,
) (IssuedVisitor, error) {
	token, err := randomToken(visitorTokenBytes, visitorTokenPrefix)
	if err != nil {
		return IssuedVisitor{}, fmt.Errorf("gen visitor token: %w", err)
	}
	data.ExpiresAt = time.Now().Add(visitorSessionTTL)
	// persist now also maintains the code→sessions index (see persist), so no separate indexByCode.
	if perr := s.persist(ctx, token, data); perr != nil {
		return IssuedVisitor{}, perr
	}
	return IssuedVisitor{Token: token, Data: *data}, nil
}

// DeleteByCode — clears all of a code's visitor sessions when the code is revoked.
// Once the token is truly dead, the next request's resolveVisitor Sessions.Get
// misses → 401 + clears the cookie (invalidation cleanup happens when it's "found
// invalid", revoke doesn't touch the browser directly).
func (s *VisitorSessionStore) DeleteByCode(ctx context.Context, codeID string) error {
	if codeID == "" {
		return nil
	}
	key := codeSessionsKeyPfx + codeID
	tokens, err := s.rdb.SMembers(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("redis smembers code sessions: %w", err)
	}
	if derr := s.delTokens(ctx, tokens); derr != nil {
		return derr
	}
	if derr := s.rdb.Del(ctx, key).Err(); derr != nil {
		return fmt.Errorf("redis del code session set: %w", derr)
	}
	return nil
}

// Get reads + slides the TTL; returns ErrVisitorSessionNotFound if absent.
func (s *VisitorSessionStore) Get(ctx context.Context, token string) (VisitorSessionData, error) {
	raw, err := s.rdb.Get(ctx, visitorSessionKeyPfx+token).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return VisitorSessionData{}, ErrVisitorSessionNotFound
		}
		return VisitorSessionData{}, fmt.Errorf("redis get visitor session: %w", err)
	}
	var data VisitorSessionData
	if uerr := json.Unmarshal(raw, &data); uerr != nil {
		return VisitorSessionData{}, fmt.Errorf("decode visitor session: %w", uerr)
	}
	data.ExpiresAt = time.Now().Add(visitorSessionTTL)
	if perr := s.persist(ctx, token, &data); perr != nil {
		return VisitorSessionData{}, perr
	}
	return data, nil
}

// Save — writes modified session data back (refreshing the TTL). Used after the
// ghost waypoint ledger marks something visited.
func (s *VisitorSessionStore) Save(
	ctx context.Context, token string, data *VisitorSessionData,
) error {
	data.ExpiresAt = time.Now().Add(visitorSessionTTL)
	return s.persist(ctx, token, data)
}

func (s *VisitorSessionStore) persist(
	ctx context.Context, token string, data *VisitorSessionData,
) error {
	payload, err := json.Marshal(data)
	if err != nil {
		return fmt.Errorf("encode visitor session: %w", err)
	}
	key := visitorSessionKeyPfx + token
	if serr := s.rdb.Set(ctx, key, payload, visitorSessionTTL).Err(); serr != nil {
		return fmt.Errorf("redis set visitor session: %w", serr)
	}
	// #8: keep the code→sessions index alive alongside the session. The token key's TTL slides on
	// every access; the index set must slide with it, else a session active past the initial issue
	// TTL falls out of the index and revoke (DeleteByCode) silently misses it.
	return s.indexByCode(ctx, data.CodeID, token)
}

// indexByCode — records the token into this code's session set, so revoke can clear
// them all at once. Skipped when there's no code (public/byoai).
func (s *VisitorSessionStore) indexByCode(ctx context.Context, codeID, token string) error {
	if codeID == "" {
		return nil
	}
	key := codeSessionsKeyPfx + codeID
	if err := s.rdb.SAdd(ctx, key, token).Err(); err != nil {
		return fmt.Errorf("redis index session by code: %w", err)
	}
	if err := s.rdb.Expire(ctx, key, visitorSessionTTL).Err(); err != nil {
		return fmt.Errorf("redis expire code session set: %w", err)
	}
	return nil
}

func (s *VisitorSessionStore) delTokens(ctx context.Context, tokens []string) error {
	for _, t := range tokens {
		if err := s.rdb.Del(ctx, visitorSessionKeyPfx+t).Err(); err != nil {
			return fmt.Errorf("redis del visitor session: %w", err)
		}
	}
	return nil
}

// randomToken — a crypto-random token (prefix + base64url). Visitor sessions hold
// their own, not borrowed from the session package.
func randomToken(byteLen int, prefix string) (string, error) {
	buf := make([]byte, byteLen)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("read random: %w", err)
	}
	return prefix + base64.RawURLEncoding.EncodeToString(buf), nil
}
