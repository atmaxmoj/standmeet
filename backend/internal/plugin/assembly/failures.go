// failures.go — the owner's face of a block that could not be mounted.
//
// `tests.md` §3, third face: *"the owner gets a persistent entry naming the block, with
// the child process's stderr."* All three words are load-bearing.
//
//   - **persistent** — a toast that appears if the owner happens to be looking is not a
//     diagnosis. This is a row, and the panel reads it on a fresh load.
//   - **naming the block** — found live on 2026-09-08: a plugin died at import, the
//     backend logged "visitor block failed to bind — hidden from this session", and
//     the owner was shown nothing. A block that silently is not there is
//     indistinguishable from one that was never installed.
//   - **the child's stderr** — the only thing a generic "failed to bind" can never
//     carry, and the only thing that says *which* import died.
//
// The visitor never sees any of this: outcome for the visitor, diagnosis for the owner.

package assembly

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// maxStderrBytes — how much of the child's last words to keep.
//
// A crashing process can print a great deal; the owner needs the reason, not the whole
// stream. Kept generous enough for a stack trace's first frames, which is where the
// import that died is named.
const maxStderrBytes = 4096

// RecordFailure — this block failed to mount for this bundle, and this is what it said.
//
// One row per (bundle, block), overwritten: the panel shows the CURRENT state of the
// bundle, not a log the owner has to scroll to find out whether the last attempt worked.
// Best-effort by design — the caller is already handling a failure, and a failure to
// record one must not become a second failure on the visitor's path.
func (r *Repo) RecordFailure(ctx context.Context, ownerID string, f *Failure) error {
	id, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	const q = `
		INSERT INTO block_failures (owner_id, block_id, title, stderr)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (owner_id, block_id)
		DO UPDATE SET title = EXCLUDED.title, stderr = EXCLUDED.stderr, failed_at = now()`
	if _, eerr := r.pool.Exec(ctx, q, id, f.BlockID, f.Title, truncate(f.Stderr)); eerr != nil {
		return fmt.Errorf("record block failure: %w", eerr)
	}
	return nil
}

// ClearFailure — this block mounted, so whatever it said last time is history.
//
// Without this the panel would accumulate permanent red for problems the owner already
// fixed, and a health indicator nobody can clear is one nobody reads.
func (r *Repo) ClearFailure(ctx context.Context, ownerID, blockID string) error {
	id, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	const q = `DELETE FROM block_failures WHERE owner_id = $1 AND block_id = $2`
	if _, eerr := r.pool.Exec(ctx, q, id, blockID); eerr != nil {
		return fmt.Errorf("clear block failure: %w", eerr)
	}
	return nil
}

// failuresOfBundle — the failures among ONE bundle's members.
//
// The join is what lets a failure be stored once and read under every bundle that
// contains the block. A bundle whose members are all healthy gets an empty list, which
// is what the panel renders as "no problems" — distinct from a bundle it could not read
// at all.
func (r *Repo) failuresOfBundle(ctx context.Context, bundleID string) ([]Failure, error) {
	id, err := pgstore.ParseUUID(bundleID)
	if err != nil {
		return nil, fmt.Errorf("parse bundle id: %w", err)
	}
	const q = `
		SELECT f.block_id, f.title, f.stderr
		FROM bundle_blocks m
		JOIN bundles b ON b.id = m.bundle_id
		JOIN block_failures f ON f.owner_id = b.owner_id AND f.block_id = m.block_id
		WHERE m.bundle_id = $1
		ORDER BY f.block_id ASC`
	rows, qerr := r.pool.Query(ctx, q, id)
	if qerr != nil {
		return nil, fmt.Errorf("bundle failures: %w", qerr)
	}
	defer rows.Close()
	return scanFailures(rows)
}

func scanFailures(rows pgx.Rows) ([]Failure, error) {
	out := make([]Failure, 0)
	for rows.Next() {
		var f Failure
		if serr := rows.Scan(&f.BlockID, &f.Title, &f.Stderr); serr != nil {
			return nil, fmt.Errorf("scan block failure: %w", serr)
		}
		out = append(out, f)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate block failures: %w", rerr)
	}
	return out, nil
}

func truncate(s string) string {
	if len(s) <= maxStderrBytes {
		return s
	}
	return s[:maxStderrBytes]
}
