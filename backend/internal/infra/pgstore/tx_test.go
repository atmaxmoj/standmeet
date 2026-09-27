package pgstore_test

import (
	"context"
	"errors"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

const probeDDL = `CREATE TABLE probe (v text NOT NULL)`

func probeCount(t *testing.T, q pgstore.DBTX) int {
	t.Helper()
	var n int
	if err := q.QueryRow(context.Background(), `SELECT count(*) FROM probe`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

func insertProbe(ctx context.Context, q pgstore.DBTX, v string) error {
	_, err := q.Exec(ctx, `INSERT INTO probe (v) VALUES ($1)`, v)
	return err
}

// mustPanic — runs fn and fails the test unless fn panics.
func mustPanic(t *testing.T, fn func()) {
	t.Helper()
	defer func() {
		if recover() == nil {
			t.Fatal("panic in fn was swallowed")
		}
	}()
	fn()
}

func TestInTxCommitsEveryWriteTogether(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, probeDDL); err != nil {
		t.Fatal(err)
	}
	err := pgstore.InTx(ctx, pool, func(tx pgstore.Tx) error {
		if err := insertProbe(ctx, tx, "a"); err != nil {
			return err
		}
		return insertProbe(ctx, tx, "b")
	})
	if err != nil {
		t.Fatalf("InTx: %v", err)
	}
	if got := probeCount(t, pool); got != 2 {
		t.Fatalf("rows after commit = %d, want 2", got)
	}
}

func TestInTxErrorRollsEveryWriteBack(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, probeDDL); err != nil {
		t.Fatal(err)
	}
	boom := errors.New("boom")
	err := pgstore.InTx(ctx, pool, func(tx pgstore.Tx) error {
		if err := insertProbe(ctx, tx, "a"); err != nil {
			return err
		}
		return boom
	})
	if !errors.Is(err, boom) {
		t.Fatalf("InTx err = %v, want the fn's error", err)
	}
	if got := probeCount(t, pool); got != 0 {
		t.Fatalf("rows after error = %d, want 0", got)
	}
}

func TestInTxPanicRollsBackAndRepanics(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, probeDDL); err != nil {
		t.Fatal(err)
	}
	mustPanic(t, func() {
		err := pgstore.InTx(ctx, pool, func(tx pgstore.Tx) error {
			if err := insertProbe(ctx, tx, "a"); err != nil {
				return err
			}
			panic("mid-transaction")
		})
		t.Errorf("InTx returned %v instead of re-panicking", err)
	})
	if got := probeCount(t, pool); got != 0 {
		t.Fatalf("rows after panic = %d, want 0", got)
	}
}
