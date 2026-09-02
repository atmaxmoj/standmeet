// claim.go —— single-winner claim: for one key, only one caller holds it at a time.
//
// Why this lives in capstore and not in a specific capability: any "peek then act" flow
// needs it — a second caller can squeeze into the window between the peek and the act, and
// both sides see the same "empty" slot. F-B-15 is its first bill: two booking requests
// arrive concurrently, each checks the busy slot and both see it free, so the real calendar
// ends up with two meetings side by side — the owner's same half hour gets double-booked.
//
// The guarantee comes from a **primary-key conflict**, not from code ordering: of two
// concurrent INSERTs, only one can land. An expired claim can be taken over (TTL), so a
// caller that dies mid-flight never locks the slot forever — that kind of stuck lock is
// harder to diagnose than no lock at all.

package capstore

import (
	"context"
	"fmt"
	"time"
)

// maxClaimTTL —— the longest a claim can live. A claim exists to cover the "peek then act"
// window, not to hold long-term; the cap is here so a buggy caller can't lock a slot forever.
const maxClaimTTL = 5 * time.Minute

// ClaimKey —— which slot, owned by whom: which capability (kind+id), which collection,
// which key. Bundled into one type instead of four positional args — at the call site it's
// easy to lose count of commas and swap id for key, and swapping those two means claiming
// someone else's slot.
type ClaimKey struct {
	Kind       Kind
	ID         string
	Collection string
	Key        string
}

// Claim —— try to take (collection, key). true = it's yours right now.
//
// Already held by someone else and not yet expired → false (not an error: losing the race
// is a normal outcome, and the caller responds with a different message accordingly).
// An expired claim counts as free; whoever asks first gets it.
func (s *Store) Claim(ctx context.Context, c ClaimKey, ttl time.Duration) (bool, error) {
	kind, id, collection, key := c.Kind, c.ID, c.Collection, c.Key
	schema, err := schemaName(kind, id)
	if err != nil {
		return false, err
	}
	sql := fmt.Sprintf(
		`INSERT INTO %s.claims (collection, key, expires_at) VALUES ($1, $2, now() + $3::interval)
		 ON CONFLICT (collection, key) DO UPDATE SET expires_at = excluded.expires_at
		 WHERE %[1]s.claims.expires_at < now()
		 RETURNING true`, schema,
	)
	var got bool
	qerr := s.pool.QueryRow(ctx, sql, collection, key, clampClaimTTL(ttl).String()).Scan(&got)
	if qerr != nil {
		return false, nil //nolint:nilerr // insert failed = held by someone else, not a fault
	}
	return got, nil
}

// Release —— give up your claim early (done / failed). Optional: the TTL will expire it anyway.
func (s *Store) Release(ctx context.Context, c ClaimKey) error {
	collection, key := c.Collection, c.Key
	schema, err := schemaName(c.Kind, c.ID)
	if err != nil {
		return err
	}
	sql := fmt.Sprintf("DELETE FROM %s.claims WHERE collection = $1 AND key = $2", schema)
	if _, derr := s.pool.Exec(ctx, sql, collection, key); derr != nil {
		return fmt.Errorf("capstore release %q/%s: %w", schema, collection, derr)
	}
	return nil
}

// clampClaimTTL —— non-positive → one minute (a default that covers the window when the
// caller doesn't say); over the cap → clamp to the cap.
func clampClaimTTL(ttl time.Duration) time.Duration {
	if ttl <= 0 {
		return time.Minute
	}
	if ttl > maxClaimTTL {
		return maxClaimTTL
	}
	return ttl
}
