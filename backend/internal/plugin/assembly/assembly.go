// Package assembly — what the owner installed, what they grouped it into, and which
// groups fell over.
//
// One package because it is one fact with three faces: a block the owner pasted in, a
// bundle that names some blocks, and the failures a bundle collected the last time
// somebody tried to use it. Splitting them would put the bundle's contents in one place
// and the bundle's health in another, and the panel reads both in the same breath.
//
// Raw pgx rather than sqlc, the same bypass `stats_activity.go` documents: these tables
// are read and written only from here, and regenerating the shared `models.go` to reach
// them re-lints every domain that shares it for no gain.
package assembly

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ErrNotFound — no such bundle / no such installed block for this owner.
//
// Its own sentinel rather than pgx.ErrNoRows: a caller deciding between "404" and "500"
// should not have to know this package uses pgx.
var ErrNotFound = errors.New("assembly: not found")

// ErrNameTaken — this owner already has a bundle by that name.
var ErrNameTaken = errors.New("assembly: bundle name already used")

// Repo — the owner's assembly, on Postgres.
type Repo struct{ pool *pgstore.Pool }

// NewRepo — constructor.
func NewRepo(pool *pgstore.Pool) *Repo { return &Repo{pool: pool} }

// InstalledBlock — one block the owner pasted in.
//
// Manifest is the text they pasted, kept verbatim: the loader reads that shape already,
// and a second column-shaped copy is only somewhere for the two to disagree.
type InstalledBlock struct {
	BlockID  string
	Title    string
	Manifest string
}

// Install — add or replace one owner-installed block.
//
// Installing the same id twice is an UPDATE, never a second row. Two rows claiming one
// id would make "which one is mounted" depend on scan order, which is the shape of bug
// that only appears once the owner has two of something.
func (r *Repo) Install(ctx context.Context, ownerID string, b *InstalledBlock) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	const q = `
		INSERT INTO installed_blocks (owner_id, block_id, title, manifest)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (owner_id, block_id)
		DO UPDATE SET title = EXCLUDED.title, manifest = EXCLUDED.manifest, updated_at = now()`
	if _, eerr := r.pool.Exec(ctx, q, ownerUUID, b.BlockID, b.Title, b.Manifest); eerr != nil {
		return fmt.Errorf("install block: %w", eerr)
	}
	return nil
}

// Uninstall — remove one owner-installed block. Removing something that is not there is
// not an error: the owner's intent (it should be gone) is already satisfied.
func (r *Repo) Uninstall(ctx context.Context, ownerID, blockID string) error {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return fmt.Errorf("parse owner id: %w", err)
	}
	const q = `DELETE FROM installed_blocks WHERE owner_id = $1 AND block_id = $2`
	if _, eerr := r.pool.Exec(ctx, q, ownerUUID, blockID); eerr != nil {
		return fmt.Errorf("uninstall block: %w", eerr)
	}
	return nil
}

// TitleOf — one installed block's declared title, or "".
//
// Read when a block fails to start, so the owner's entry says "Acme Broken" instead of
// "acme.broken.zzfixture". An id is what the machine calls it; a failure the owner is
// meant to act on has to name the thing they installed.
func (r *Repo) TitleOf(ctx context.Context, ownerID, blockID string) string {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return ""
	}
	var title string
	const q = `SELECT title FROM installed_blocks WHERE owner_id = $1 AND block_id = $2`
	if serr := r.pool.QueryRow(ctx, q, ownerUUID, blockID).Scan(&title); serr != nil {
		return ""
	}
	return title
}

// ListInstalled — every block this owner installed, oldest first.
//
// Oldest first because the list is read next to the built-ins, which are in
// registration order; a list that reshuffles on every read makes "did something appear"
// impossible to answer by looking.
func (r *Repo) ListInstalled(ctx context.Context, ownerID string) ([]InstalledBlock, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf("parse owner id: %w", err)
	}
	const q = `
		SELECT block_id, title, manifest FROM installed_blocks
		WHERE owner_id = $1 ORDER BY created_at ASC, block_id ASC`
	rows, qerr := r.pool.Query(ctx, q, ownerUUID)
	if qerr != nil {
		return nil, fmt.Errorf("list installed blocks: %w", qerr)
	}
	defer rows.Close()
	return scanInstalled(rows)
}

func scanInstalled(rows pgx.Rows) ([]InstalledBlock, error) {
	out := make([]InstalledBlock, 0)
	for rows.Next() {
		var b InstalledBlock
		if serr := rows.Scan(&b.BlockID, &b.Title, &b.Manifest); serr != nil {
			return nil, fmt.Errorf("scan installed block: %w", serr)
		}
		out = append(out, b)
	}
	if rerr := rows.Err(); rerr != nil {
		return nil, fmt.Errorf("iterate installed blocks: %w", rerr)
	}
	return out, nil
}
