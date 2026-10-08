package main

import (
	"context"
	"log/slog"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// A boot failure (a panic, or an error returned after the background listeners started) leaves a
// connection held by a goroutine on a context nothing cancels. pgxpool.Close waits for it forever,
// so the process neither exits nor prints the panic: the container just sat unhealthy (found
// 2026-10-07, a dispatcher conformance panic). Closing the pool on the way out must give up.
func TestClosingThePoolDoesNotWaitForAHeldConnection(t *testing.T) {
	t.Parallel()
	pool := poolWithAHeldConn(t)
	done := make(chan struct{})
	go func() {
		closePool(slog.New(slog.DiscardHandler), pool)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(poolCloseGrace + 3*time.Second):
		t.Fatal("closing the pool waited on a held connection; a failed boot would hang here")
	}
}

// poolWithAHeldConn —— a pool on the test database with one connection acquired and never
// released, the shape a still-running listener leaves behind.
func poolWithAHeldConn(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("STANDMEET_TEST_PG")
	if url == "" {
		t.Fatal("STANDMEET_TEST_PG is unset: run the DB-backed tests through `make backend-test`")
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Acquire(context.Background()); err != nil {
		t.Fatal(err)
	}
	return pool
}
