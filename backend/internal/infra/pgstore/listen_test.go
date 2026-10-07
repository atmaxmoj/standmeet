package pgstore_test

import (
	"context"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// A NOTIFY sent while the listener is not listening yet (startup, or a reconnect) is lost by
// Postgres. A waiter registered before it must still be woken once listening starts, to re-check
// the state it waits on. Found by CI (2026-10-07): the events relay registered, drained an empty
// outbox, and an event recorded before LISTEN was established stayed undelivered until the
// periodic sweep.
func TestAWaiterRegisteredBeforeListeningIsWokenWhenListeningStarts(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	const maxWaiters = 4
	l := pgstore.NewListener(pool, "probe_listen", maxWaiters, nil)
	w, ok := l.Register("k")
	if !ok {
		t.Fatal("register")
	}
	defer w.Release()
	if err := pgstore.Notify(context.Background(), pool, "probe_listen", "k"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go l.Run(ctx)
	if !w.Await(context.Background(), time.After(5*time.Second)) {
		t.Fatal("the waiter was never woken: a NOTIFY before LISTEN is lost for good")
	}
}
