// vault_sync.go —— Obsidian vault sync 的跨-genre corpus_notes reconcile 仓储。
// 不绑 genre：sync 要按 title(basename)跨 genre 认「同一条」，且移动可改 genre —— 所以独立于
// genre-bound NoteRepo。只暴露 reconcile 三面：按 title 认领、create、update(relocate + 重写)。
// vault 是 single live source:reconcile 一律以 vault 为准,没有 web-wins(F-L-6)。

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

// VaultSyncRepo —— vault sync 的 corpus_notes 仓储。
type VaultSyncRepo struct{ pool *pgstore.Pool }

// NewVaultSyncRepo 构造。
func NewVaultSyncRepo(pool *pgstore.Pool) *VaultSyncRepo { return &VaultSyncRepo{pool: pool} }

// SyncNote —— reconcile 视图：认领(title) + 变更比对 + 定位(genre/parent)。
type SyncNote struct {
	ImportedAt time.Time
	UpdatedAt  time.Time
	ID         string
	Genre      string
	ParentID   string
	Title      string
	Body       string
	Excerpt    string
	// Lang / Aliases —— 导出要写回 frontmatter 的两样（F-L-59）。
	//
	// 它们**不是装饰**：aliases 是链接解析的输入（`[[别名]]` 靠它解开），lang 是多语言
	// 渲染契约的一半。以前这个视图没有它们，于是导出连读都没读 —— 而 owner 用「导出」
	// 再导回来，就会把真语料上的这两样抹平。
	Lang        string
	Tags        []string
	Aliases     []string
	HasImported bool
	Published   bool
}

// ErrSyncNoteNotFound —— GetByTitle 没认领到(不是错误,是「新建」信号)。
var ErrSyncNoteNotFound = errors.New("sync note not found")

// GetByTitle —— 按 owner+title 认领 reconcile 目标(跨 genre;basename 全 vault 唯一)。
// 没有 → ErrSyncNoteNotFound。
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

// GetBySourcePath —— 按 owner + vault 相对路径认领 reconcile 目标。title(basename)不是
// 全 vault 唯一时用它:不同文件夹下同名文件各有唯一 source_path,据此认对行而非拒绝碰撞。
// 没有 → ErrSyncNoteNotFound。
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

// GetSyncNote —— 按 id 取一条 corpus note(任一 genre)。search 索引单条 + 走父链算 path 用。
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

// CreateSyncNoteInput —— vault sync create。ParentID "" = 根。
type CreateSyncNoteInput struct {
	ParentID    *string
	OwnerID     string
	Genre       string
	Title       string
	Body        string
	Excerpt     string // frontmatter `excerpt:` — the separate authored summary
	SourcePath  string
	InboxSource string // genre='raw' 的 vault 来源标签 "obsidian:<path>";其它 genre 空
	Tags        []string
	CSSClasses  []string
	Aliases     []string
	// Lang / LangLabels —— frontmatter 的 `lang:` / `lang-labels:`(见 schema 上的注释:
	// 语言**集**不存,它从正文的语言面推)。
	Lang       string
	LangLabels []byte
	Published  bool
}

// Create —— 建一条 sync note，返 id。
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
	})
	if qerr != nil {
		return "", fmt.Errorf("create sync note: %w", qerr)
	}
	return pgstore.FormatUUID(row.ID), nil
}

// UpdateSyncNoteInput —— vault sync update(relocate + 重写)。
type UpdateSyncNoteInput struct {
	ParentID    *string
	OwnerID     string
	ID          string
	Genre       string
	Body        string
	Excerpt     string // frontmatter `excerpt:` — the separate authored summary
	SourcePath  string
	InboxSource string // genre='raw' 的 vault 来源标签 "obsidian:<path>";其它 genre 空
	Tags        []string
	CSSClasses  []string
	Aliases     []string
	Lang        string
	LangLabels  []byte
	Published   bool
}

// Update —— reconcile 更新一条(genre/parent 可变 = 移动;body/tags/publish 刷新;重盖 obsidian 元数据)。
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
	}); qerr != nil {
		return fmt.Errorf("update sync note: %w", qerr)
	}
	return nil
}

// jsonOrEmpty —— nil → `{}`。jsonb 列不收 NULL,而"没写 lang-labels"是**空表**,不是坏值。
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

// QueryNoteRow —— 原生查询命中的一条:leaf id + genre + root→leaf 的 path 段 + 它自己的
// 公开开关(准入要问这一个,见 access.AllowsCorpusEntry)。
type QueryNoteRow struct {
	ID         string
	Genre      string
	PathTitles []string
	Published  bool
}

// QueryNotes —— 按 genre/tag(空串 = 不筛)查 corp note,path 在 SQL 里沿 parent 链算好。
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

// GetCSSClasses —— 一条 note 的 cssclasses(best-effort,corpus_read 补进 Entry;错→空)。
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

// ListAllForExport —— owner 所有 corp note(任一 genre),给 vault export 反向渲染成 .md。
func (r *VaultSyncRepo) ListAllForExport(ctx context.Context, ownerID string) ([]SyncNote, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListAllNotesForExport(ctx, owner)
	if qerr != nil {
		return nil, fmt.Errorf("list notes for export: %w", qerr)
	}
	out := make([]SyncNote, 0, len(rows))
	for i := range rows {
		sn := SyncNote{
			ID: pgstore.FormatUUID(rows[i].ID), Genre: rows[i].Genre, Title: rows[i].Title,
			Body: rows[i].Body, Published: rows[i].Published, Tags: rows[i].Tags,
			Lang: rows[i].Lang, Aliases: rows[i].Aliases,
		}
		if rows[i].ParentID.Valid {
			sn.ParentID = pgstore.FormatUUID(rows[i].ParentID)
		}
		out = append(out, sn)
	}
	return out, nil
}

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
