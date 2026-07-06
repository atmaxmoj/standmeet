// vault_sync.go —— Obsidian vault sync 的跨-genre corpus_notes reconcile 仓储。
// 不绑 genre：sync 要按 title(basename)跨 genre 认「同一条」，且移动可改 genre —— 所以独立于
// genre-bound NoteRepo。只暴露 reconcile 三面：按 title 认领、create、update(relocate + 重写)。
// web-wins 判定(updated_at > imported_at)在 usecase 层用 SyncNote 的时间字段做。

package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// VaultSyncRepo —— vault sync 的 corpus_notes 仓储。
type VaultSyncRepo struct{ pool *Pool }

// NewVaultSyncRepo 构造。
func NewVaultSyncRepo(pool *Pool) *VaultSyncRepo { return &VaultSyncRepo{pool: pool} }

// SyncNote —— reconcile 视图：认领(title) + web-wins(updated vs imported) + 定位(genre/parent)。
type SyncNote struct {
	ImportedAt  time.Time
	UpdatedAt   time.Time
	ID          string
	Genre       string
	ParentID    string
	Title       string
	Body        string
	Tags        []string
	HasImported bool
	Published   bool
}

// ErrSyncNoteNotFound —— GetByTitle 没认领到(不是错误,是「新建」信号)。
var ErrSyncNoteNotFound = errors.New("sync note not found")

// GetByTitle —— 按 owner+title 认领 reconcile 目标(跨 genre;basename 全 vault 唯一)。
// 没有 → ErrSyncNoteNotFound。
func (r *VaultSyncRepo) GetByTitle(ctx context.Context, ownerID, title string) (SyncNote, error) {
	owner, err := parseUUID(ownerID)
	if err != nil {
		return SyncNote{}, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	row, qerr := dbq.New(r.pool).GetNoteByTitleAnyGenre(ctx, dbq.GetNoteByTitleAnyGenreParams{
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

// CreateSyncNoteInput —— vault sync create。ParentID "" = 根。
type CreateSyncNoteInput struct {
	ParentID   *string
	OwnerID    string
	Genre      string
	Title      string
	Body       string
	SourcePath string
	Tags       []string
	Published  bool
}

// Create —— 建一条 sync note，返 id。
func (r *VaultSyncRepo) Create(ctx context.Context, in *CreateSyncNoteInput) (string, error) {
	owner, err := parseUUID(in.OwnerID)
	if err != nil {
		return "", fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return "", fmt.Errorf("parse parent id: %w", err)
	}
	row, qerr := dbq.New(r.pool).CreateNoteSync(ctx, dbq.CreateNoteSyncParams{
		OwnerID: owner, Genre: in.Genre, ParentID: parent, Title: in.Title,
		Body: in.Body, Tags: nilSafeTags(in.Tags), Published: in.Published,
		ObsidianSourcePath: in.SourcePath,
	})
	if qerr != nil {
		return "", fmt.Errorf("create sync note: %w", qerr)
	}
	return formatUUID(row.ID), nil
}

// UpdateSyncNoteInput —— vault sync update(relocate + 重写)。
type UpdateSyncNoteInput struct {
	ParentID   *string
	OwnerID    string
	ID         string
	Genre      string
	Body       string
	SourcePath string
	Tags       []string
	Published  bool
}

// Update —— reconcile 更新一条(genre/parent 可变 = 移动;body/tags/publish 刷新;重盖 obsidian 元数据)。
func (r *VaultSyncRepo) Update(ctx context.Context, in *UpdateSyncNoteInput) error {
	ids, perr := parseSrcAndOwner(in.ID, in.OwnerID)
	if perr != nil {
		return perr
	}
	parent, err := parseOptionalUUID(in.ParentID)
	if err != nil {
		return fmt.Errorf("parse parent id: %w", err)
	}
	if _, qerr := dbq.New(r.pool).UpdateNoteSync(ctx, dbq.UpdateNoteSyncParams{
		ID: ids.Src, OwnerID: ids.Owner, Genre: in.Genre, ParentID: parent,
		Body: in.Body, Tags: nilSafeTags(in.Tags), Published: in.Published,
		ObsidianSourcePath: in.SourcePath,
	}); qerr != nil {
		return fmt.Errorf("update sync note: %w", qerr)
	}
	return nil
}

// ListAllForExport —— owner 所有 corp note(任一 genre),给 vault export 反向渲染成 .md。
func (r *VaultSyncRepo) ListAllForExport(ctx context.Context, ownerID string) ([]SyncNote, error) {
	owner, err := parseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(errParseOwnerIDPrefix, err)
	}
	rows, qerr := dbq.New(r.pool).ListAllNotesForExport(ctx, owner)
	if qerr != nil {
		return nil, fmt.Errorf("list notes for export: %w", qerr)
	}
	out := make([]SyncNote, 0, len(rows))
	for i := range rows {
		sn := SyncNote{
			ID: formatUUID(rows[i].ID), Genre: rows[i].Genre, Title: rows[i].Title,
			Body: rows[i].Body, Published: rows[i].Published, Tags: rows[i].Tags,
		}
		if rows[i].ParentID.Valid {
			sn.ParentID = formatUUID(rows[i].ParentID)
		}
		out = append(out, sn)
	}
	return out, nil
}

func syncNoteFromRow(n *dbq.CorpusNote) SyncNote {
	out := SyncNote{
		ID: formatUUID(n.ID), Genre: n.Genre, Title: n.Title, Body: n.Body,
		Published: n.Published, Tags: n.Tags,
	}
	if n.ParentID.Valid {
		out.ParentID = formatUUID(n.ParentID)
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
