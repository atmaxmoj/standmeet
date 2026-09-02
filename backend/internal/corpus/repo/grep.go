// grep.go — the scan surface for corpus_grep: every note the owner has,
// bodies included.
//
// Kept in its own file, because it's a different concern from the "sync one
// note" reads/writes next door in vault_sync: those fetch one note by id/path,
// this one hands over every body at once for a regex scan.

package repo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GrepNoteRow — one row of the scan surface: leaf id + genre + path segments +
// **body**.
type GrepNoteRow struct {
	ID         string
	Genre      string
	Body       string
	PathTitles []string
	// Published — this row's own public/private switch. grep is never-miss: it
	// scans every note, so admission must be decided row by row, and this value
	// is the criterion for public identity (access.AllowsCorpusEntry).
	Published bool
}

// NotesWithBodies — every note the owner has, bodies included.
//
// No pagination, no cap: never-miss means "if it's there, it will be found,"
// and a cap would quietly turn that into "usually found." The corpus's scale
// problem is left to the second-phase index to solve, not to reading fewer rows.
func (r *VaultSyncRepo) NotesWithBodies(
	ctx context.Context, ownerID string,
) ([]GrepNoteRow, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).GrepCorpusNotes(ctx, owner)
	if qerr != nil {
		return nil, fmt.Errorf("grep corpus notes: %w", qerr)
	}
	out := make([]GrepNoteRow, 0, len(rows))
	for i := range rows {
		out = append(out, GrepNoteRow{
			ID:         pgstore.FormatUUID(rows[i].ID),
			Genre:      rows[i].Genre,
			Body:       rows[i].Body,
			PathTitles: rows[i].PathTitles,
			Published:  rows[i].Published,
		})
	}
	return out, nil
}

// NoteLang — a note's identity language + switcher labels. Both can be absent
// (most notes are single-language).
type NoteLang struct {
	Labels map[string]string
	Lang   string
}

// GetLang — reads those two frontmatter fields. Best-effort: unreadable is
// treated as unset (single-language rendering) — a note's language label isn't
// worth turning a read into a 500.
func (r *VaultSyncRepo) GetLang(ctx context.Context, ownerID, id string) NoteLang {
	ids, err := parseSrcAndOwner(id, ownerID)
	if err != nil {
		return NoteLang{}
	}
	row, qerr := db.New(r.pool).GetNoteLang(ctx, db.GetNoteLangParams{
		ID: ids.Src, OwnerID: ids.Owner,
	})
	if qerr != nil {
		return NoteLang{}
	}
	labels := map[string]string{}
	if uerr := json.Unmarshal(row.LangLabels, &labels); uerr != nil {
		labels = map[string]string{}
	}
	return NoteLang{Lang: row.Lang, Labels: labels}
}
