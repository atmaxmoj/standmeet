// writing_refs.go —— `[[crosslink]]` 边表 CRUD。
//
// SaveWriting 同事务调 ReplaceRefsBySrcTx 重建 src 出度（delete old + insert
// new）；public /writings GET 调 BacklinksFor 查入度。FK cascade 保证 writing
// 删了对应边自动消。

package corpus

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/pgstore"
	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// WritingRefRepo —— writing_refs 表 CRUD。
type WritingRefRepo struct {
	pool *pgstore.Pool
}

// NewWritingRefRepo 构造。
func NewWritingRefRepo(pool *pgstore.Pool) *WritingRefRepo { return &WritingRefRepo{pool: pool} }

// WritingRef —— 一条 backlink / outbound ref 返回值（slug + title）。
type WritingRef struct {
	Slug  string
	Title string
}

// srcOwnerUUIDs —— parseSrcAndOwner 的返回打包，避免 result-limit。
type srcOwnerUUIDs struct {
	Src, Owner pgtype.UUID
}

// ReplaceRefsBySrcTx —— delete + insert 重建 src writing 的出度。同 SaveWriting
// tx 内调，跟 writing 行更新一起 commit。dstIDs 必须已去重（caller 负责）。
func (*WritingRefRepo) ReplaceRefsBySrcTx(
	ctx context.Context, tx dbq.DBTX,
	srcID, ownerID string, dstIDs []string,
) error {
	ids, perr := parseSrcAndOwner(srcID, ownerID)
	if perr != nil {
		return perr
	}
	q := dbq.New(tx)
	if derr := q.DeleteRefsBySrc(ctx, ids.Src); derr != nil {
		return fmt.Errorf("delete old refs: %w", derr)
	}
	return insertNewRefs(ctx, q, ids.Src, ids.Owner, dstIDs)
}

func parseSrcAndOwner(srcID, ownerID string) (srcOwnerUUIDs, error) {
	srcUUID, perr := pgstore.ParseUUID(srcID)
	if perr != nil {
		return srcOwnerUUIDs{}, fmt.Errorf("parse src id: %w", perr)
	}
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return srcOwnerUUIDs{}, fmt.Errorf("parse owner id: %w", oerr)
	}
	return srcOwnerUUIDs{Src: srcUUID, Owner: ownerUUID}, nil
}

func insertNewRefs(
	ctx context.Context, q *dbq.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstIDs []string,
) error {
	for _, dstID := range dstIDs {
		if err := insertOneRef(ctx, q, srcUUID, ownerUUID, dstID); err != nil {
			return err
		}
	}
	return nil
}

func insertOneRef(
	ctx context.Context, q *dbq.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstID string,
) error {
	dstUUID, derr := pgstore.ParseUUID(dstID)
	if derr != nil {
		return fmt.Errorf("parse dst id %s: %w", dstID, derr)
	}
	if err := q.InsertWritingRef(ctx, dbq.InsertWritingRefParams{
		SrcWritingID: srcUUID, DstWritingID: dstUUID, OwnerID: ownerUUID,
	}); err != nil {
		return fmt.Errorf("insert ref: %w", err)
	}
	return nil
}

// BacklinksFor —— 列指向 dstID 的所有 (源 writing slug, 源 writing title)。
// 只列源 writing 已 published（visitor 看不到草稿 backlink）。
func (r *WritingRefRepo) BacklinksFor(
	ctx context.Context, ownerID, dstID string,
) ([]WritingRef, error) {
	dstUUID, derr := pgstore.ParseUUID(dstID)
	if derr != nil {
		return nil, fmt.Errorf("parse dst id: %w", derr)
	}
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf("parse owner id: %w", oerr)
	}
	rows, err := dbq.New(r.pool).ListBacklinksForWriting(ctx, dbq.ListBacklinksForWritingParams{
		DstWritingID: dstUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		return nil, fmt.Errorf("list backlinks: %w", err)
	}
	return mapRefs(rows), nil
}

func mapRefs(rows []dbq.ListBacklinksForWritingRow) []WritingRef {
	out := make([]WritingRef, 0, len(rows))
	for i := range rows {
		out = append(out, WritingRef{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out
}
