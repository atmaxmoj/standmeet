// tx.go — the one way a transaction is opened (gate: check-tx-only-via-pgstore.sh).
//
// The transaction is an explicit parameter, never a ctx value: fn receives it, and whoever
// should join it is handed it (`repo.With(tx)`, `events.With(tx)`, `jobs.With(tx)`). Whether a
// write joins the transaction is then visible at the call site and checked by the compiler,
// instead of depending on what the caller's ctx happens to carry.

package pgstore

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Tx — an open transaction. Satisfies DBTX.
type Tx = pgx.Tx

// Beginner — what a transaction opens on: the pool, or an open transaction (then it is a
// savepoint inside that transaction).
type Beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Nested — where a repo bound by With(q) opens its own transaction: a savepoint inside q when q
// is a transaction, else a transaction of its own on pool.
func Nested(q DBTX, pool *Pool) Beginner {
	if tx, ok := q.(Tx); ok {
		return tx
	}
	return pool
}

// InTx — begins a transaction on db, hands it to fn, commits when fn returns nil and rolls back
// otherwise. A panic in fn rolls back and re-panics.
func InTx(ctx context.Context, db Beginner, fn func(tx Tx) error) error {
	tx, err := db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck // re-panicking below
			panic(p)
		}
	}()
	if err = fn(tx); err != nil {
		//nolint:errcheck // fn's error is the one to report
		_ = tx.Rollback(context.WithoutCancel(ctx))
		return err
	}
	if err = tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit tx: %w", err)
	}
	return nil
}
