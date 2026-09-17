// bundle_includes.go — the id-addressed, list-replacing, nestable half of a bundle
// (access-control.md "Additive, over a bundle referenced by id" + "Bundles nest").
//
// The name-addressed incremental ops in bundles.go stay for the GUI; these are what the
// additive-ACL surface drives: set the whole block list at once, include other bundles by
// reference, resolve a code's grant as the recursive deduped union. Membership is still
// read LIVE at every assembly (ResolveMembers, no snapshot) — block-model.md's immediate
// unmount, unchanged by nesting.

package assembly

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ErrCycle — a proposed include edge would let a bundle reach itself. Refused at write: a
// cycle adds nothing to the union (the back-edge reaches only blocks already collected) and
// a naive resolver would not terminate. The caller turns this into a 4xx.
var ErrCycle = errors.New("assembly: bundle include would create a cycle")

// ownsBundle — the bundle's uuid IFF it belongs to this owner. A bundle addressed by a
// caller who does not own it is ErrNotFound, never someone else's row.
func (r *Repo) ownsBundle(ctx context.Context, ownerID, bundleID string) (pgtype.UUID, error) {
	var zero pgtype.UUID
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return zero, fmt.Errorf("parse owner id: %w", oerr)
	}
	id, ierr := pgstore.ParseUUID(bundleID)
	if ierr != nil {
		return zero, fmt.Errorf("bundle %q: %w", bundleID, ErrNotFound)
	}
	var got pgtype.UUID
	const q = `SELECT id FROM bundles WHERE id = $1 AND owner_id = $2`
	if serr := r.pool.QueryRow(ctx, q, id, ownerUUID).Scan(&got); serr != nil {
		if errors.Is(serr, pgx.ErrNoRows) {
			return zero, fmt.Errorf("bundle %q: %w", bundleID, ErrNotFound)
		}
		return zero, fmt.Errorf("resolve bundle: %w", serr)
	}
	return got, nil
}

// ReplaceBlocks — set a bundle's whole membership at once (the additive surface sets a
// list; it does not add and remove one at a time). Clear then insert inside one
// transaction so a reader never sees the half-applied set.
func (r *Repo) ReplaceBlocks(ctx context.Context, ownerID, bundleID string, blocks []string) error {
	id, err := r.ownsBundle(ctx, ownerID, bundleID)
	if err != nil {
		return err
	}
	tx, terr := r.pool.Begin(ctx)
	if terr != nil {
		return fmt.Errorf("begin replace blocks: %w", terr)
	}
	defer func() { _ = tx.Rollback(ctx) }() //nolint:errcheck // commit path returns ErrTxClosed
	if _, derr := tx.Exec(ctx, `DELETE FROM bundle_blocks WHERE bundle_id = $1`, id); derr != nil {
		return fmt.Errorf("clear bundle blocks: %w", derr)
	}
	if ierr := insertBlocks(ctx, tx, id, blocks); ierr != nil {
		return ierr
	}
	return commitTx(ctx, tx, "replace blocks")
}

// insertBlocks — the member inserts of one ReplaceBlocks transaction.
func insertBlocks(ctx context.Context, tx pgx.Tx, id pgtype.UUID, blocks []string) error {
	const ins = `INSERT INTO bundle_blocks (bundle_id, block_id) VALUES ($1, $2)
		ON CONFLICT (bundle_id, block_id) DO NOTHING`
	for _, b := range blocks {
		if _, ierr := tx.Exec(ctx, ins, id, b); ierr != nil {
			return fmt.Errorf("insert bundle block: %w", ierr)
		}
	}
	return nil
}

// SetIncludes — set a bundle's whole set of included bundles at once, refusing any edge
// that would create a cycle (checked before the write, against the live graph).
func (r *Repo) SetIncludes(
	ctx context.Context, ownerID, bundleID string, includeIDs []string,
) error {
	id, err := r.ownsBundle(ctx, ownerID, bundleID)
	if err != nil {
		return err
	}
	for _, inc := range includeIDs {
		if verr := r.verifyIncludable(ctx, ownerID, bundleID, inc); verr != nil {
			return verr
		}
	}
	return r.writeIncludes(ctx, id, includeIDs)
}

// verifyIncludable — one proposed edge bundle→include is legal: the include is this owner's,
// and it does not already reach back to bundle (which would close a cycle).
func (r *Repo) verifyIncludable(ctx context.Context, ownerID, bundleID, includeID string) error {
	if includeID == bundleID {
		return fmt.Errorf("%q includes itself: %w", bundleID, ErrCycle)
	}
	if _, oerr := r.ownsBundle(ctx, ownerID, includeID); oerr != nil {
		return oerr
	}
	reaches, rerr := r.reaches(ctx, includeID, bundleID)
	if rerr != nil {
		return rerr
	}
	if reaches {
		return fmt.Errorf("%q already reaches %q: %w", includeID, bundleID, ErrCycle)
	}
	return nil
}

// writeIncludes — replace the bundle's include edges in one transaction.
func (r *Repo) writeIncludes(ctx context.Context, id pgtype.UUID, includeIDs []string) error {
	tx, terr := r.pool.Begin(ctx)
	if terr != nil {
		return fmt.Errorf("begin set includes: %w", terr)
	}
	defer func() { _ = tx.Rollback(ctx) }() //nolint:errcheck // commit path returns ErrTxClosed
	const del = `DELETE FROM bundle_includes WHERE bundle_id = $1`
	if _, derr := tx.Exec(ctx, del, id); derr != nil {
		return fmt.Errorf("clear bundle includes: %w", derr)
	}
	if ierr := insertIncludes(ctx, tx, id, includeIDs); ierr != nil {
		return ierr
	}
	return commitTx(ctx, tx, "set includes")
}

// insertIncludes — the edge inserts of one SetIncludes transaction, in listed order.
func insertIncludes(ctx context.Context, tx pgx.Tx, id pgtype.UUID, includeIDs []string) error {
	const ins = `INSERT INTO bundle_includes (bundle_id, includes_id, position) VALUES ($1, $2, $3)
		ON CONFLICT (bundle_id, includes_id) DO NOTHING`
	for pos, inc := range includeIDs {
		incUUID, perr := pgstore.ParseUUID(inc)
		if perr != nil {
			return fmt.Errorf("parse include id: %w", perr)
		}
		if _, ierr := tx.Exec(ctx, ins, id, incUUID, pos); ierr != nil {
			return fmt.Errorf("insert bundle include: %w", ierr)
		}
	}
	return nil
}

// reaches — does `from` reach `target` by following include edges? An iterative DFS with a
// visited set, so a graph that is already cyclic (should not happen — writes refuse it) or
// merely diamond-shaped still terminates.
func (r *Repo) reaches(ctx context.Context, from, target string) (bool, error) {
	seen := map[string]bool{}
	stack := []string{from}
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if cur == target {
			return true, nil
		}
		if seen[cur] {
			continue
		}
		seen[cur] = true
		kids, err := r.includeIDs(ctx, cur)
		if err != nil {
			return false, err
		}
		stack = append(stack, kids...)
	}
	return false, nil
}

// ResolveMembers — the blocks a code's bundle grants, RIGHT NOW: the recursive, deduped
// union of the bundle's own members and every bundle it includes. Read live, never
// snapshotted (the whole revocation story). Empty id → nothing.
func (r *Repo) ResolveMembers(ctx context.Context, bundleID string) ([]string, error) {
	if bundleID == "" {
		return []string{}, nil
	}
	acc := &memberAcc{seenBundle: map[string]bool{}, seenBlock: map[string]bool{}, out: []string{}}
	if err := r.collect(ctx, bundleID, acc); err != nil {
		return nil, err
	}
	return acc.out, nil
}

// memberAcc — the running state of a ResolveMembers walk: which bundles and blocks have
// been seen, and the deduped block list in first-seen order.
type memberAcc struct {
	seenBundle map[string]bool
	seenBlock  map[string]bool
	out        []string
}

func (r *Repo) collect(ctx context.Context, bundleID string, acc *memberAcc) error {
	if acc.seenBundle[bundleID] {
		return nil
	}
	acc.seenBundle[bundleID] = true
	blocks, err := r.membersByID(ctx, bundleID)
	if err != nil {
		return err
	}
	acc.add(blocks)
	return r.collectIncludes(ctx, bundleID, acc)
}

// collectIncludes — recurse into every bundle this one includes.
func (r *Repo) collectIncludes(ctx context.Context, bundleID string, acc *memberAcc) error {
	kids, kerr := r.includeIDs(ctx, bundleID)
	if kerr != nil {
		return kerr
	}
	for _, k := range kids {
		if cerr := r.collect(ctx, k, acc); cerr != nil {
			return cerr
		}
	}
	return nil
}

// add — append the not-yet-seen blocks, preserving first-seen order (a block reached both
// directly and through a nested bundle appears once).
func (acc *memberAcc) add(blocks []string) {
	for _, b := range blocks {
		if !acc.seenBlock[b] {
			acc.seenBlock[b] = true
			acc.out = append(acc.out, b)
		}
	}
}

// DeleteBundleByID — remove an owner's bundle by id. Codes bound to it fall back to the
// role (access_codes.bundle_id ON DELETE SET NULL); members and includes cascade.
func (r *Repo) DeleteBundleByID(ctx context.Context, ownerID, bundleID string) error {
	id, err := r.ownsBundle(ctx, ownerID, bundleID)
	if err != nil {
		return err
	}
	if _, eerr := r.pool.Exec(ctx, `DELETE FROM bundles WHERE id = $1`, id); eerr != nil {
		return fmt.Errorf("delete bundle: %w", eerr)
	}
	return nil
}

// includeIDs — the bundles this one includes, in the owner's chosen order.
func (r *Repo) includeIDs(ctx context.Context, bundleID string) ([]string, error) {
	id, err := pgstore.ParseUUID(bundleID)
	if err != nil {
		return nil, fmt.Errorf("parse bundle id: %w", err)
	}
	const q = `SELECT includes_id FROM bundle_includes
		WHERE bundle_id = $1 ORDER BY position ASC, added_at ASC`
	rows, qerr := r.pool.Query(ctx, q, id)
	if qerr != nil {
		return nil, fmt.Errorf("bundle includes: %w", qerr)
	}
	defer rows.Close()
	return scanBundleIDs(rows)
}

// scanBundleIDs — drain a single uuid column into formatted id strings.
func scanBundleIDs(rows pgx.Rows) ([]string, error) {
	out := make([]string, 0)
	for rows.Next() {
		var id pgtype.UUID
		if serr := rows.Scan(&id); serr != nil {
			return nil, fmt.Errorf("scan bundle include: %w", serr)
		}
		out = append(out, pgstore.FormatUUID(id))
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate bundle includes: %w", rerr)
	}
	return out, nil
}

// commitTx — commit and name what failed if it does.
func commitTx(ctx context.Context, tx pgx.Tx, what string) error {
	if cerr := tx.Commit(ctx); cerr != nil {
		return fmt.Errorf("commit %s: %w", what, cerr)
	}
	return nil
}
