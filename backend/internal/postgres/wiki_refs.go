// wiki_refs.go —— wiki `[[Title]]` 双链边表 CRUD（镜像 writing_refs，但 wiki 无
// slug：边按 wiki.id 存，返回 id + title，path 由 usecase 用 WikiTreePaths 算）。
//
// PromoteToWiki / UpdateWiki 同事务调 ReplaceRefsBySrcTx 重建 src 出度；public
// landing 调 BacklinksFor（入度=cited by）+ OutboundFor（出度=read next/sources）。

package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/postgres/dbq"
)

// WikiRefRepo —— wiki_refs 表 CRUD。
type WikiRefRepo struct {
	pool *Pool
}

// NewWikiRefRepo 构造。
func NewWikiRefRepo(pool *Pool) *WikiRefRepo { return &WikiRefRepo{pool: pool} }

// WikiRef —— 一条 backlink / outbound ref（目标 wiki 的 id + title）。path 由
// caller 用全树派生算（wiki 地址是树路径，不存）。
type WikiRef struct {
	ID    string
	Title string
}

// ReplaceRefsBySrcTx —— delete + insert 重建 src wiki 的出度。同写 wiki 行的 tx
// 内调。dstIDs 必须已去重 + 排除 self-link（caller 负责）。
func (*WikiRefRepo) ReplaceRefsBySrcTx(
	ctx context.Context, tx dbq.DBTX,
	srcID, ownerID string, dstIDs []string,
) error {
	ids, perr := parseSrcAndOwner(srcID, ownerID)
	if perr != nil {
		return perr
	}
	q := dbq.New(tx)
	if derr := q.DeleteWikiRefsBySrc(ctx, ids.Src); derr != nil {
		return fmt.Errorf("delete old wiki refs: %w", derr)
	}
	return insertNewWikiRefs(ctx, q, ids.Src, ids.Owner, dstIDs)
}

func insertNewWikiRefs(
	ctx context.Context, q *dbq.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstIDs []string,
) error {
	for _, dstID := range dstIDs {
		if err := insertOneWikiRef(ctx, q, srcUUID, ownerUUID, dstID); err != nil {
			return err
		}
	}
	return nil
}

func insertOneWikiRef(
	ctx context.Context, q *dbq.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstID string,
) error {
	dstUUID, derr := parseUUID(dstID)
	if derr != nil {
		return fmt.Errorf("parse dst id %s: %w", dstID, derr)
	}
	if err := q.InsertWikiRef(ctx, dbq.InsertWikiRefParams{
		SrcWikiID: srcUUID, DstWikiID: dstUUID, OwnerID: ownerUUID,
	}); err != nil {
		return fmt.Errorf("insert wiki ref: %w", err)
	}
	return nil
}

// BacklinksFor —— 「cited by」：列指向 dstID 的源 wiki（id + title），只 seo_indexed。
func (r *WikiRefRepo) BacklinksFor(
	ctx context.Context, ownerID, dstID string,
) ([]WikiRef, error) {
	ids, perr := parseSrcAndOwner(dstID, ownerID)
	if perr != nil {
		return nil, perr
	}
	rows, err := dbq.New(r.pool).ListWikiBacklinks(ctx, dbq.ListWikiBacklinksParams{
		DstWikiID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		return nil, fmt.Errorf("list wiki backlinks: %w", err)
	}
	out := make([]WikiRef, 0, len(rows))
	for i := range rows {
		out = append(out, WikiRef{ID: formatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}

// OutboundFor —— 「read next / sources」：src 引用了哪些 wiki（id + title），只
// seo_indexed。「N corpus sources」= len(返回)。
func (r *WikiRefRepo) OutboundFor(
	ctx context.Context, srcID string,
) ([]WikiRef, error) {
	srcUUID, perr := parseUUID(srcID)
	if perr != nil {
		return nil, fmt.Errorf("parse src id: %w", perr)
	}
	rows, err := dbq.New(r.pool).ListWikiOutbound(ctx, srcUUID)
	if err != nil {
		return nil, fmt.Errorf("list wiki outbound: %w", err)
	}
	out := make([]WikiRef, 0, len(rows))
	for i := range rows {
		out = append(out, WikiRef{ID: formatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}
