// bundles.go — the group the owner assembles, and the list a code resolves to.
//
// The load-bearing property is in `Members`: it is read at every assembly, never copied
// onto the code. `block-model.md` says unmount is immediate — no draining, no timeout —
// and a snapshot taken when the code was issued would make "the owner removes a block"
// mean "the next visitor won't see it", which is useless to an owner revoking access in
// a hurry.

package assembly

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Bundle — a named group, with its members and whatever went wrong last time.
type Bundle struct {
	ID       string
	Name     string
	Blocks   []string
	Failures []Failure
}

// Failure — one block that could not be mounted, and what the child said.
type Failure struct {
	BlockID string
	Title   string
	Stderr  string
}

// uniqueViolation — Postgres's code for "that name is taken".
const uniqueViolation = "23505"

// CreateBundle — a new, empty group.
//
// A name collision comes back as ErrNameTaken rather than a generic write failure: the
// owner typed a name they already used, which is something they can fix, and telling
// them "could not save" instead sends them looking at the wrong thing.
func (r *Repo) CreateBundle(ctx context.Context, ownerID, name string) (string, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return "", fmt.Errorf("parse owner id: %w", err)
	}
	var id pgtype.UUID
	const q = `INSERT INTO bundles (owner_id, name) VALUES ($1, $2) RETURNING id`
	if serr := r.pool.QueryRow(ctx, q, ownerUUID, name).Scan(&id); serr != nil {
		var pgErr *pgconn.PgError
		if errors.As(serr, &pgErr) && pgErr.Code == uniqueViolation {
			return "", fmt.Errorf("%q: %w", name, ErrNameTaken)
		}
		return "", fmt.Errorf("create bundle: %w", serr)
	}
	return pgstore.FormatUUID(id), nil
}

// DeleteBundle — remove a group. Codes bound to it fall back to the role (ON DELETE SET
// NULL), which is why deleting one is safe to offer at all.
func (r *Repo) DeleteBundle(ctx context.Context, ownerID, name string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	const q = `DELETE FROM bundles WHERE owner_id = $1 AND name = $2`
	if _, eerr := r.pool.Exec(ctx, q, ownerUUID, name); eerr != nil {
		return fmt.Errorf("delete bundle: %w", eerr)
	}
	return nil
}

// AddBlock — put a block in a bundle, addressed by the owner's own words (bundle name,
// block id) rather than by a row id the panel would have to carry around.
func (r *Repo) AddBlock(ctx context.Context, ownerID, name, blockID string) error {
	id, err := r.bundleID(ctx, ownerID, name)
	if err != nil {
		return err
	}
	const q = `
		INSERT INTO bundle_blocks (bundle_id, block_id) VALUES ($1, $2)
		ON CONFLICT (bundle_id, block_id) DO NOTHING`
	if _, eerr := r.pool.Exec(ctx, q, id, blockID); eerr != nil {
		return fmt.Errorf("add block to bundle: %w", eerr)
	}
	return nil
}

// RemoveBlock — take a block out of a bundle. Addressed the same way as AddBlock, and it
// bites immediately: the bundle is read live at assembly, so a session already open loses the
// block on its next turn.
func (r *Repo) RemoveBlock(ctx context.Context, ownerID, name, blockID string) error {
	id, err := r.bundleID(ctx, ownerID, name)
	if err != nil {
		return err
	}
	const q = `DELETE FROM bundle_blocks WHERE bundle_id = $1 AND block_id = $2`
	if _, eerr := r.pool.Exec(ctx, q, id, blockID); eerr != nil {
		return fmt.Errorf("remove block from bundle: %w", eerr)
	}
	return nil
}

// ListBundles — every group this owner has, with members and failures attached.
//
// Three queries rather than one join: a join across two one-to-many edges multiplies the
// rows and has to be de-duplicated in Go, and de-duplication is where a member silently
// goes missing.
func (r *Repo) ListBundles(ctx context.Context, ownerID string) ([]Bundle, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("parse owner id: %w", err)
	}
	const q = `SELECT id, name FROM bundles WHERE owner_id = $1 ORDER BY created_at ASC`
	rows, qerr := r.pool.Query(ctx, q, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list bundles: %w", qerr)
	}
	bundles, serr := scanBundles(rows)
	rows.Close()
	if serr != nil {
		return nil, serr
	}
	return r.attachAll(ctx, bundles)
}

// attachAll — fill in each bundle's members and failures. One bundle failing to load fails the
// whole list: a bundle rendered without its members reads as an empty bundle, which is the one
// thing an owner must never be shown by accident.
func (r *Repo) attachAll(ctx context.Context, bundles []Bundle) ([]Bundle, error) {
	for i := range bundles {
		if aerr := r.attach(ctx, &bundles[i]); aerr != nil {
			return nil, aerr
		}
	}
	return bundles, nil
}

func scanBundles(rows pgx.Rows) ([]Bundle, error) {
	out := make([]Bundle, 0)
	for rows.Next() {
		var id pgtype.UUID
		var name string
		if serr := rows.Scan(&id, &name); serr != nil {
			return nil, fmt.Errorf("scan bundle: %w", serr)
		}
		out = append(out, Bundle{
			ID: pgstore.FormatUUID(id), Name: name,
			Blocks: []string{}, Failures: []Failure{},
		})
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate bundles: %w", rerr)
	}
	return out, nil
}

func (r *Repo) attach(ctx context.Context, b *Bundle) error {
	members, merr := r.membersByID(ctx, b.ID)
	if merr != nil {
		return merr
	}
	b.Blocks = members
	fails, ferr := r.failuresOfBundle(ctx, b.ID)
	if ferr != nil {
		return ferr
	}
	b.Failures = fails
	return nil
}

// Members — the blocks a code's bundle contains, RIGHT NOW.
//
// The whole model rests on this being a read and not a snapshot. Empty id → no members
// and no error: a code whose bundle was deleted is not a fault, it is a code that has
// nothing, and the caller falls back to the role.
func (r *Repo) Members(ctx context.Context, bundleID string) ([]string, error) {
	if bundleID == "" {
		return []string{}, nil
	}
	return r.membersByID(ctx, bundleID)
}

func (r *Repo) membersByID(ctx context.Context, bundleID string) ([]string, error) {
	id, err := pgstore.ParseUUID(bundleID)
	if err != nil {
		return nil, fmt.Errorf("parse bundle id: %w", err)
	}
	const q = `SELECT block_id FROM bundle_blocks WHERE bundle_id = $1 ORDER BY added_at ASC`
	rows, qerr := r.pool.Query(ctx, q, id)
	if qerr != nil {
		return nil, fmt.Errorf("bundle members: %w", qerr)
	}
	defer rows.Close()
	return scanMemberIDs(rows)
}

// scanMemberIDs — drain the rows into block ids, in the order the owner added them.
func scanMemberIDs(rows pgx.Rows) ([]string, error) {
	out := make([]string, 0)
	for rows.Next() {
		var blockID string
		if serr := rows.Scan(&blockID); serr != nil {
			return nil, fmt.Errorf("scan bundle member: %w", serr)
		}
		out = append(out, blockID)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate bundle members: %w", rerr)
	}
	return out, nil
}

// bundleID — resolve the owner's name for a bundle to its id, scoped to that owner so a
// name cannot reach across instances' owners.
func (r *Repo) bundleID(ctx context.Context, ownerID, name string) (pgtype.UUID, error) {
	var zero pgtype.UUID
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return zero, fmt.Errorf("parse owner id: %w", err)
	}
	var id pgtype.UUID
	const q = `SELECT id FROM bundles WHERE owner_id = $1 AND name = $2`
	if serr := r.pool.QueryRow(ctx, q, ownerUUID, name).Scan(&id); serr != nil {
		if errors.Is(serr, pgx.ErrNoRows) {
			return zero, fmt.Errorf("bundle %q: %w", name, ErrNotFound)
		}
		return zero, fmt.Errorf("resolve bundle: %w", serr)
	}
	return id, nil
}
