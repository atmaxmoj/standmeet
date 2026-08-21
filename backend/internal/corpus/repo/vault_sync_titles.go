// vault_sync_titles.go —— reconcile 的第三种身份问题:「这个标题指得准吗」。
//
// GetByTitle 是跨 genre 的认领口,而它落在 `ORDER BY created_at ASC LIMIT 1` 上 —— 标题一旦
// 在语料里不唯一,认到哪一条就是抓阄,输的那条常常是这次上传根本没提的、住在另一个 genre 的
// 同名笔记。所以 sync 动手之前先问语料:哪些标题是有歧义的(F-L-61)。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// DuplicateTitles —— owner 语料里出现不止一次的标题(已小写,跨 genre)。空表 = 每个标题都唯一。
func (r *VaultSyncRepo) DuplicateTitles(ctx context.Context, ownerID string) ([]string, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	titles, qerr := db.New(r.pool).ListDuplicateNoteTitles(ctx, owner)
	if qerr != nil {
		return nil, fmt.Errorf("list duplicate note titles: %w", qerr)
	}
	return titles, nil
}

// GetByTitleInGenre —— 在**这一个 genre 里**按 title 认领。结构节点(文件夹占位)用它:
// 它没有 source_path,身份就是「自己那棵树上的那个文件夹」。没有 → ErrSyncNoteNotFound。
func (r *VaultSyncRepo) GetByTitleInGenre(
	ctx context.Context, ownerID, genre, title string,
) (SyncNote, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return SyncNote{}, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	row, qerr := db.New(r.pool).GetNoteByTitleInGenre(ctx, db.GetNoteByTitleInGenreParams{
		OwnerID: owner, Genre: genre, Title: title,
	})
	if qerr != nil {
		if errors.Is(qerr, pgx.ErrNoRows) {
			return SyncNote{}, ErrSyncNoteNotFound
		}
		return SyncNote{}, fmt.Errorf("get note by title in genre: %w", qerr)
	}
	return syncNoteFromRow(&row), nil
}
