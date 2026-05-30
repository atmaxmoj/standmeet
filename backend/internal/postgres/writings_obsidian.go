// writings_obsidian.go —— WritingRepo 上跟 Obsidian sync 相关的两条 method，
// 拆出来让 writings.go 不超 350-line cap，且让 obsidian 字段语义聚焦一处。

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
func (r *WritingRepo) GetByObsidianSourcePath(
	ctx context.Context, ownerID, sourcePath string,
) (domain.Writing, error) {
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return domain.Writing{}, fmt.Errorf(errParseOwnerIDPrefix, oerr)
	}
	row, err := dbq.New(r.pool).GetWritingByObsidianSourcePath(ctx,
		dbq.GetWritingByObsidianSourcePathParams{
			OwnerID: ownerUUID, ObsidianSourcePath: sourcePath,
		})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return domain.Writing{}, domain.ErrWritingNotFound
		}
		return domain.Writing{}, fmt.Errorf("get writing by obsidian path: %w", err)
	}
	return toDomainWriting(&row), nil
}

// SetObsidianMeta —— Obsidian import 成功 SaveWriting 之后调用：标记这行
// writing 是从 vault 来的 (source_path)，imported_at = now()。下次 re-import
// 时 updated_at vs imported_at 判 owner 是否在 web 上覆写过。
func (r *WritingRepo) SetObsidianMeta(
	ctx context.Context, ownerID, writingID, sourcePath string,
) error {
	args, perr := parseOwnerAndWritingID(ownerID, writingID)
	if perr != nil {
		return perr
	}
	if err := dbq.New(r.pool).SetWritingObsidianMeta(ctx, dbq.SetWritingObsidianMetaParams{
		ID: args.writingUUID, OwnerID: args.ownerUUID, ObsidianSourcePath: sourcePath,
	}); err != nil {
		return fmt.Errorf("set obsidian meta: %w", err)
	}
	return nil
}
