package connector_test

import (
	"context"
	"strconv"
	"sync"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// hubStubConn — a minimal Connector, for use in Hub concurrency tests.
type hubStubConn struct{ name string }

func (c hubStubConn) Name() string                                  { return c.name }
func (hubStubConn) Kind() string                                    { return "openapi" }
func (hubStubConn) Connected(context.Context, string) (bool, error) { return true, nil }

// TestHubConcurrentUpsertResolve — an owner creating/changing a connector at runtime (Upsert,
// writes the map) and a visitor's category-slot resolution (Resolve, reads the map) happen
// concurrently. With an unlocked Hub, go test -race must fail red with "concurrent map read and
// map write" (and prod would fatal outright). With locking added, this test passes cleanly —
// it's the guard for that concurrency invariant.
func TestHubConcurrentUpsertResolve(t *testing.T) {
	t.Parallel()
	h := connector.NewHub()
	const n = 64
	var wg sync.WaitGroup
	for i := range n {
		id := strconv.Itoa(i)
		wg.Go(func() { h.Upsert(hubStubConn{name: id}) })
		wg.Go(func() { _, _ = h.Resolve(id) })
	}
	wg.Wait()
}
