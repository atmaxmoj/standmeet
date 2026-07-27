// visitor_session_revoke_test.go —— #8: revoking a code must kill sessions that are still active
// past the initial 60m issue TTL. The token key's TTL slides on every access; before the fix the
// code→sessions index set's TTL was set only at issue, so a long-lived active session fell out of
// the index and DeleteByCode silently missed it. Uses miniredis + FastForward for a deterministic
// TTL clock (no real Redis, no wall-clock waiting).

package session_test

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/session"
)

func TestRevokeFindsLongLivedActiveSession(t *testing.T) {
	t.Parallel()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	store := session.NewVisitorSessionStore(redis.NewClient(&redis.Options{Addr: mr.Addr()}))
	ctx := context.Background()

	issued, err := store.Issue(ctx, &session.VisitorSessionData{
		CodeID: "code-1", OwnerID: "owner-1", Mode: "code",
	})
	require.NoError(t, err)

	// Keep the session active well past the 60m issue TTL: touch it before each window elapses so
	// the token key slides. The index set must slide with it, or revoke loses the session.
	for range 3 {
		mr.FastForward(50 * time.Minute)
		_, gerr := store.Get(ctx, issued.Token)
		require.NoError(t, gerr, "an actively-used session stays alive")
	}

	// Revoke the code — must still find + kill the active session.
	require.NoError(t, store.DeleteByCode(ctx, "code-1"))
	_, gerr := store.Get(ctx, issued.Token)
	require.ErrorIs(t, gerr, session.ErrVisitorSessionNotFound, "revoked session must be gone")
}
