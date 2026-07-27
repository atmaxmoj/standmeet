// agent_turn_queue_test.go —— #7: the visitor-turn path must actually consult the query queue
// (it was constructed but never called → the concurrency guard was dead). Exercises the wiring
// helper: per-session single-flight is enforced, and release frees the slot.

package public

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/session"
)

func TestAcquireTurnSlotEnforcesSingleFlight(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	q := session.NewQueryQueue(0) // global cap off (dev default); per-session guard still active

	release, err := acquireTurnSlot(ctx, q, "sess-1")
	require.NoError(t, err, "first turn acquires")

	_, busyErr := acquireTurnSlot(ctx, q, "sess-1")
	require.ErrorIs(t, busyErr, session.ErrSessionBusy,
		"a second concurrent turn for the same session is refused")

	release() // first turn ends
	release2, err := acquireTurnSlot(ctx, q, "sess-1")
	require.NoError(t, err, "after release the session can turn again")
	release2()
}

func TestAcquireTurnSlotNilQueueIsNoop(t *testing.T) {
	t.Parallel()
	release, err := acquireTurnSlot(context.Background(), nil, "sess-1")
	require.NoError(t, err)
	release() // must not panic
}
