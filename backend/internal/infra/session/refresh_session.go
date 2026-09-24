// refresh_session.go —— the long-lived REFRESH token behind "stay signed in". Login issues one
// alongside the short-lived access session; when the access cookie expires the frontend silently
// POSTs /api/admin/refresh, which rotates BOTH tokens. The owner stays signed in as long as they
// return within the refresh window, without the access session having to live for days.
//
// Redis key: `refresh:{token}` → the owner id, TTL RefreshTTL.
// Rotation is SINGLE-USE: Rotate does an atomic GETDEL, so a refresh token works exactly once. A
// replay of an already-rotated token finds nothing → ErrRefreshInvalid — the cheap theft signal
// (if a token is stolen and used, the legitimate holder's next refresh fails and they re-auth).

package session

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	refreshTokenBytes = 32
	refreshTokenPfx   = "smr_"
	refreshKeyPfx     = "refresh:"
	// RefreshTTL — how long "stay signed in" lasts without activity. Sliding: each rotation mints a
	// fresh token with the full window, so an owner who returns within it never signs in again.
	RefreshTTL = 30 * 24 * time.Hour
)

// ErrRefreshInvalid —— the presented refresh token isn't in Redis (expired, already rotated, or
// forged). The caller clears the cookies and returns 401.
var ErrRefreshInvalid = errors.New("refresh token invalid")

// Rotated —— the result of a successful rotation: the owner the old token belonged to, and the
// fresh token to set as the new refresh cookie.
type Rotated struct {
	OwnerID string
	Token   string
}

// RefreshStore wraps Redis for refresh-token CRUD. No business logic.
type RefreshStore struct {
	rdb *redis.Client
}

// NewRefreshStore constructs a store.
func NewRefreshStore(rdb *redis.Client) *RefreshStore {
	return &RefreshStore{rdb: rdb}
}

// Issue mints a refresh token bound to ownerID and persists it with RefreshTTL.
func (s *RefreshStore) Issue(ctx context.Context, ownerID string) (string, error) {
	tok, err := randomToken(refreshTokenBytes, refreshTokenPfx)
	if err != nil {
		return "", fmt.Errorf("gen refresh token: %w", err)
	}
	if serr := s.rdb.Set(ctx, refreshKeyPfx+tok, ownerID, RefreshTTL).Err(); serr != nil {
		return "", fmt.Errorf("persist refresh token: %w", serr)
	}
	return tok, nil
}

// Rotate consumes oldToken (single-use, atomic GETDEL) and issues a fresh one for the same owner.
// Returns ErrRefreshInvalid if the old token isn't live. On success the old token is already gone,
// so it can never be replayed.
func (s *RefreshStore) Rotate(ctx context.Context, oldToken string) (Rotated, error) {
	ownerID, gerr := s.rdb.GetDel(ctx, refreshKeyPfx+oldToken).Result()
	if errors.Is(gerr, redis.Nil) || ownerID == "" {
		return Rotated{}, ErrRefreshInvalid
	}
	if gerr != nil {
		return Rotated{}, fmt.Errorf("rotate refresh token: %w", gerr)
	}
	newToken, ierr := s.Issue(ctx, ownerID)
	if ierr != nil {
		return Rotated{}, ierr
	}
	return Rotated{OwnerID: ownerID, Token: newToken}, nil
}

// Revoke deletes a refresh token (logout). A nonexistent token counts as success (idempotent).
func (s *RefreshStore) Revoke(ctx context.Context, token string) error {
	if err := s.rdb.Del(ctx, refreshKeyPfx+token).Err(); err != nil {
		return fmt.Errorf("revoke refresh token: %w", err)
	}
	return nil
}

// RefreshResult —— a rotated refresh token plus the fresh access session minted for the same owner.
type RefreshResult struct {
	Session      IssuedSession
	RefreshToken string
}

// Client —— the requester's IP + user agent, recorded on the fresh session.
type Client struct {
	IP string
	UA string
}

// Refresh —— rotate oldToken and mint a fresh access session for its owner. The branching that a
// route face isn't allowed to carry lives here: rotate → issue. ErrRefreshInvalid (or an issue
// error) means the caller clears the cookies and returns 401.
func Refresh(
	ctx context.Context, rs *RefreshStore, ss *OwnerSessionStore, oldToken string, c Client,
) (RefreshResult, error) {
	rot, err := rs.Rotate(ctx, oldToken)
	if err != nil {
		return RefreshResult{}, err
	}
	issued, ierr := ss.Issue(ctx, rot.OwnerID, c.IP, c.UA)
	if ierr != nil {
		return RefreshResult{}, ierr
	}
	return RefreshResult{Session: issued, RefreshToken: rot.Token}, nil
}

// RevokePair —— revoke both tokens on logout. Best-effort: cookies are cleared regardless, so the
// caller just logs any returned error rather than failing the logout. Empty strings / a nil refresh
// store are skipped.
func RevokePair(
	ctx context.Context, ss *OwnerSessionStore, rs *RefreshStore, sessionTok, refreshTok string,
) error {
	return errors.Join(revokeAccess(ctx, ss, sessionTok), revokeRefresh(ctx, rs, refreshTok))
}

func revokeAccess(ctx context.Context, ss *OwnerSessionStore, token string) error {
	if token == "" {
		return nil
	}
	return ss.Revoke(ctx, token)
}

func revokeRefresh(ctx context.Context, rs *RefreshStore, token string) error {
	if token == "" || rs == nil {
		return nil
	}
	return rs.Revoke(ctx, token)
}
