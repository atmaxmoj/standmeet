// vault_sync.go —— the cross-genre corpus_notes reconcile repo for Obsidian vault sync.
// Not bound to a genre: sync must claim "the same note" across genres by title (basename), and
// a move can change the genre — so it's kept separate from the genre-bound NoteRepo. Exposes
// only the three reconcile faces: claim by title, create, update (relocate + rewrite).
// The vault is the single live source: reconcile always defers to the vault, there's no
// web-wins path (F-L-6).

package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// VaultSyncRepo —— the corpus_notes repo for vault sync.
type VaultSyncRepo struct{ pool *pgstore.Pool }

// NewVaultSyncRepo constructs one.
func NewVaultSyncRepo(pool *pgstore.Pool) *VaultSyncRepo { return &VaultSyncRepo{pool: pool} }

// SyncNote —— the reconcile view: claim (by title) + diff comparison + location (genre/parent).
type SyncNote struct {
	ImportedAt time.Time
	UpdatedAt  time.Time
	ID         string
	Genre      string
	ParentID   string
	Title      string
	Body       string
	Excerpt    string
	// Lang / Aliases —— the two things export must write back to frontmatter (F-L-59).
	//
	// They are **not decoration**: aliases is the input to link resolution (`[[alias]]`
	// resolves through it), and lang is half of the multilingual render contract. This view
	// used to lack them, so export never even read them — and an owner running "export" then
	// re-importing would flatten both of these on the real corpus.
	Lang string
	// Excerpt / CSSClasses / LangLabels —— three things the product **stores** but has never
	// exported (F-L-67). The last fix to this shape (F-L-59) only caught the lang/aliases pair;
	// their neighbors were left as-is.
	CSSClasses []string
	LangLabels map[string]string
	// SourcePath —— which vault file this note came from. Export uses it to preserve
	// **layout**: a folder-note ("only itself inside its folder") has no children in the tree,
	// and looking at the tree alone would write it out as a sibling file instead (F-L-68).
	SourcePath string
	// Frontmatter —— the verbatim frontmatter block from the vault (without the `---` fence).
	// Export patches against it to preserve keys the product doesn't recognize and their
	// original shape (F-L-67). Empty = this note didn't come from the vault.
	Frontmatter string
	Tags        []string
	Aliases     []string
	HasImported bool
	Published   bool
}

// ErrSyncNoteNotFound —— GetByTitle found no claim (not an error — a "create new" signal).
var ErrSyncNoteNotFound = errors.New("sync note not found")

// GetByTitle —— claims a reconcile target by owner+title (cross-genre; basename is unique
// across the whole vault). No match → ErrSyncNoteNotFound.
func (r *VaultSyncRepo) GetByTitle(ctx context.Context, ownerID, title string) (SyncNote, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return SyncNote{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetNoteByTitleAnyGenre(ctx, db.GetNoteByTitleAnyGenreParams{
		OwnerID: owner, Title: title,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return SyncNote{}, ErrSyncNoteNotFound
		}
		return SyncNote{}, fmt.Errorf("get note by title: %w", qerr)
	}
	return syncNoteFromRow(&row), nil
}

// GetBySourcePath —— claims a reconcile target by owner + vault-relative path. Used when
// title (basename) isn't unique across the whole vault: same-named files in different folders
// each have a unique source_path, so this claims the right row instead of rejecting on
// collision. No match → ErrSyncNoteNotFound.
func (r *VaultSyncRepo) GetBySourcePath(
	ctx context.Context, ownerID, sourcePath string,
) (SyncNote, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return SyncNote{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetNoteBySourcePath(ctx, db.GetNoteBySourcePathParams{
		OwnerID: owner, ObsidianSourcePath: sourcePath,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return SyncNote{}, ErrSyncNoteNotFound
		}
		return SyncNote{}, fmt.Errorf("get note by source path: %w", qerr)
	}
	return syncNoteFromRow(&row), nil
}

// GetSyncNote —— fetches one corpus note by id (any genre). Used to index a single search
// entry, and to walk the parent chain and compute a path.
func (r *VaultSyncRepo) GetSyncNote(ctx context.Context, ownerID, id string) (SyncNote, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return SyncNote{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	noteID, perr := pgstore.ParseUUID(id)
	if perr != nil {
		return SyncNote{}, fmt.Errorf("parse note id: %w", perr)
	}
	row, qerr := db.New(r.pool).GetNoteByIDAnyGenre(ctx, db.GetNoteByIDAnyGenreParams{
		OwnerID: owner, ID: noteID,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return SyncNote{}, ErrSyncNoteNotFound
		}
		return SyncNote{}, fmt.Errorf("get note by id: %w", qerr)
	}
	return syncNoteFromRow(&row), nil
}

// CreateSyncNoteInput —— input for a vault sync create. ParentID "" = root.
type CreateSyncNoteInput struct {
	ParentID    *string
	OwnerID     string
	Genre       string
	Title       string
	Body        string
	Excerpt     string // frontmatter `excerpt:` — the separate authored summary
	SourcePath  string
	InboxSource string // genre='raw' vault-origin tag "obsidian:<path>"; empty for other genres
	// Frontmatter —— the **verbatim** frontmatter block for this file in the vault (without the
	// `---` fence). Keys the product doesn't recognize, and their shape (inline arrays / key
	// order), live only here. See the comment on the schema.
	Frontmatter string
	// Lang / LangLabels —— frontmatter's `lang:` / `lang-labels:` (see the schema comment: the
	// language **set** isn't stored — it's derived from the body's language facets).
	Lang       string
	Tags       []string
	CSSClasses []string
	Aliases    []string
	LangLabels []byte
	Published  bool
}

// Create —— creates one sync note, returns its id.
func (r *VaultSyncRepo) Create(ctx context.Context, in *CreateSyncNoteInput) (string, error) {
	owner, err := pgstore.ParseUUID(in.OwnerID)
	if err != nil {
		return "", fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return "", fmt.Errorf("parse parent id: %w", err)
	}
	row, qerr := db.New(r.pool).CreateNoteSync(ctx, db.CreateNoteSyncParams{
		OwnerID: owner, Genre: in.Genre, ParentID: parent, Title: in.Title,
		Body: in.Body, Tags: nilSafeTags(in.Tags), Published: in.Published,
		ObsidianSourcePath: in.SourcePath, CssClasses: nilSafeTags(in.CSSClasses),
		Aliases:     nilSafeTags(in.Aliases),
		InboxSource: in.InboxSource, Excerpt: in.Excerpt,
		Lang: in.Lang, LangLabels: jsonOrEmpty(in.LangLabels),
		ObsidianFrontmatter: in.Frontmatter,
	})
	if qerr != nil {
		return "", fmt.Errorf("create sync note: %w", qerr)
	}
	return pgstore.FormatUUID(row.ID), nil
}

// UpdateSyncNoteInput —— input for a vault sync update (relocate + rewrite).
// Frontmatter is the same as CreateSyncNoteInput: the verbatim block from the vault.
type UpdateSyncNoteInput struct {
	ParentID    *string
	OwnerID     string
	ID          string
	Genre       string
	Body        string
	Excerpt     string // frontmatter `excerpt:` — the separate authored summary
	SourcePath  string
	InboxSource string // genre='raw' vault-origin tag "obsidian:<path>"; empty for other genres
	Frontmatter string
	Lang        string
	Tags        []string
	CSSClasses  []string
	Aliases     []string
	LangLabels  []byte
	Published   bool
}

// Update —— reconcile-updates one row (genre/parent can change = a move; body/tags/publish
// refresh; obsidian metadata is overwritten wholesale).
func (r *VaultSyncRepo) Update(ctx context.Context, in *UpdateSyncNoteInput) error {
	ids, perr := parseSrcAndOwner(in.ID, in.OwnerID)
	if perr != nil {
		return perr
	}
	parent, err := pgstore.ParseOptionalUUID(in.ParentID)
	if err != nil {
		return fmt.Errorf("parse parent id: %w", err)
	}
	if _, qerr := db.New(r.pool).UpdateNoteSync(ctx, db.UpdateNoteSyncParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: in.Genre, ParentID: parent,
		Body: in.Body, Tags: nilSafeTags(in.Tags), Published: in.Published,
		ObsidianSourcePath: in.SourcePath, CssClasses: nilSafeTags(in.CSSClasses),
		Aliases:     nilSafeTags(in.Aliases),
		InboxSource: in.InboxSource, Excerpt: in.Excerpt,
		Lang: in.Lang, LangLabels: jsonOrEmpty(in.LangLabels),
		ObsidianFrontmatter: in.Frontmatter,
	}); qerr != nil {
		return fmt.Errorf("update sync note: %w", qerr)
	}
	return nil
}

// jsonOrEmpty —— nil → `{}`. The jsonb column rejects NULL, and "no lang-labels written" is
// an **empty map**, not a bad value.
func jsonOrEmpty(b []byte) []byte {
	if len(b) == 0 {
		return []byte("{}")
	}
	return b
}

// PruneAbsentVaultNotes —— F-L-6: an AUTHORITATIVE (whole-vault) sync removes the vault-imported
// notes that are NOT in keepIDs (i.e. the ones deleted from the vault since the last sync), so the
// corpus converges on the vault instead of only ever growing. Returns how many rows went.
//
// Only ever touches what the vault owns: rows that came FROM a vault import. Notes authored on the
// web or pushed via the service handle have no vault source, so their absence carries no
// instruction. Refs and child rows cascade. Callers MUST NOT call this for a partial upload.
func (r *VaultSyncRepo) PruneAbsentVaultNotes(
	ctx context.Context, ownerID string, keepIDs []string,
) (int, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return 0, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	keep := make([]pgtype.UUID, 0, len(keepIDs))
	for _, id := range keepIDs {
		parsed, perr := pgstore.ParseUUID(id)
		if perr != nil {
			return 0, fmt.Errorf("parse keep id: %w", perr)
		}
		keep = append(keep, parsed)
	}
	n, qerr := db.New(r.pool).PruneAbsentVaultNotes(ctx, db.PruneAbsentVaultNotesParams{
		OwnerID: owner, Column2: keep,
	})
	if qerr != nil {
		return 0, fmt.Errorf("prune absent vault notes: %w", qerr)
	}
	return int(n), nil
}

// QueryNoteRow —— one row from a raw query: leaf id + genre + the root→leaf path segments +
// its own publish toggle (admission checks this one, see access.AllowsCorpusEntry).
type QueryNoteRow struct {
	ID         string
	Genre      string
	PathTitles []string
	Published  bool
}

// QueryNotes —— queries corpus notes by genre/tag (empty string = no filter); the path is
// computed in SQL by walking the parent chain.
func (r *VaultSyncRepo) QueryNotes(
	ctx context.Context, ownerID, genre, tag string,
) ([]QueryNoteRow, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).QueryCorpusNotes(ctx, db.QueryCorpusNotesParams{
		OwnerID: owner, Column2: genre, Column3: tag,
	})
	if qerr != nil {
		return nil, fmt.Errorf("query corpus notes: %w", qerr)
	}
	out := make([]QueryNoteRow, 0, len(rows))
	for i := range rows {
		out = append(out, QueryNoteRow{
			ID:         pgstore.FormatUUID(rows[i].ID),
			Genre:      rows[i].Genre,
			PathTitles: rows[i].PathTitles,
			Published:  rows[i].Published,
		})
	}
	return out, nil
}

// GetCSSClasses —— a note's cssclasses (best-effort, corpus_read merges it into Entry;
// error → empty slice).
func (r *VaultSyncRepo) GetCSSClasses(ctx context.Context, ownerID, id string) []string {
	ids, err := parseSrcAndOwner(id, ownerID)
	if err != nil {
		return []string{}
	}
	classes, qerr := db.New(r.pool).GetNoteCssClasses(ctx, db.GetNoteCssClassesParams{
		ID: ids.Src, OwnerID: ids.Owner,
	})
	if qerr != nil {
		return []string{}
	}
	return classes
}

// ListAllForExport + decodeLangLabels live in vault_sync_export.go —— export is
// a separate concern.

func syncNoteFromRow(n *db.CorpusNote) SyncNote {
	out := SyncNote{
		ID: pgstore.FormatUUID(n.ID), Genre: n.Genre, Title: n.Title, Body: n.Body,
		Excerpt: n.Excerpt, Published: n.Published, Tags: n.Tags,
	}
	if n.ParentID.Valid {
		out.ParentID = pgstore.FormatUUID(n.ParentID)
	}
	if n.UpdatedAt.Valid {
		out.UpdatedAt = n.UpdatedAt.Time
	}
	if n.ObsidianImportedAt.Valid {
		out.ImportedAt = n.ObsidianImportedAt.Time
		out.HasImported = true
	}
	return out
}
