// posts_obsidian.go —— PostRepo 上跟 Obsidian sync 相关的两条 method，
// 拆出来让 posts.go 不超 350-line cap，且让 obsidian 字段语义聚焦一处。

package postgres

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// GetByObsidianSourcePath —— Obsidian import 时按 vault 内相对路径找已经
// import 过的行；命中 = re-import / 没命中 = 新行。
func (r *PostRepo) GetByObsidianSourcePath(
	ctx context.Context, ownerID, sourcePath string,
) (domain.Post, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return domain.Post{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).GetPostByObsidianSourcePath(ctx,
		dbq.GetPostByObsidianSourcePathParams{
			OwnerID: ownerUUID, ObsidianSourcePath: sourcePath,
		})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Post{}, domain.ErrPostNotFound
		}
		return domain.Post{}, fmt.Errorf("get post by obsidian path: %w", err)
	}
	return toDomainPost(&row), nil
}

// SetObsidianMeta —— Obsidian import 成功 SavePost 之后调用：标记这行 post
// 是从 vault 来的 (source_path)，imported_at = now()。下次 re-import 时
// updated_at vs imported_at 判 owner 是否在 web 上覆写过。
func (r *PostRepo) SetObsidianMeta(
	ctx context.Context, ownerID, postID, sourcePath string,
) error {
	args, perr := parseOwnerAndPostID(ownerID, postID)
	if perr != nil {
		return perr
	}
	if err := dbq.New(r.pool).SetPostObsidianMeta(ctx, dbq.SetPostObsidianMetaParams{
		ID: args.postUUID, OwnerID: args.ownerUUID, ObsidianSourcePath: sourcePath,
	}); err != nil {
		return fmt.Errorf("set obsidian meta: %w", err)
	}
	return nil
}
