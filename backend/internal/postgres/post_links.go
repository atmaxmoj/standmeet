// post_links.go —— `[[crosslink]]` 边表 CRUD。
//
// SavePost 同事务调 ReplaceLinksBySrcTx 重建 src 出度（delete old + insert
// new）；public /blog GET 调 BacklinksFor 查入度。FK cascade 保证 post
// 删了对应边自动消。

package postgres

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/wangsijie/standmeet/internal/postgres/dbq"
)

// PostLinkRepo —— post_links 表 CRUD。
type PostLinkRepo struct {
	pool *Pool
}

// NewPostLinkRepo 构造。
func NewPostLinkRepo(pool *Pool) *PostLinkRepo { return &PostLinkRepo{pool: pool} }

// PostLinkRef —— 一条 backlink / outbound link 返回值（slug + title）。
type PostLinkRef struct {
	Slug  string
	Title string
}

// srcOwnerUUIDs —— parseSrcAndOwner 的返回打包，避免 result-limit。
type srcOwnerUUIDs struct {
	Src, Owner pgtype.UUID
}

// ReplaceLinksBySrcTx —— delete + insert 重建 src post 的出度。同 SavePost
// tx 内调，跟 post 行更新一起 commit。dstIDs 必须已去重（caller 负责）。
func (*PostLinkRepo) ReplaceLinksBySrcTx(
	ctx context.Context, tx dbq.DBTX,
	srcID, ownerID string, dstIDs []string,
) error {
	ids, perr := parseSrcAndOwner(srcID, ownerID)
	if perr != nil {
		return perr
	}
	q := dbq.New(tx)
	if derr := q.DeleteLinksBySrc(ctx, ids.Src); derr != nil {
		return fmt.Errorf("delete old links: %w", derr)
	}
	return insertNewLinks(ctx, q, ids.Src, ids.Owner, dstIDs)
}

func parseSrcAndOwner(srcID, ownerID string) (srcOwnerUUIDs, error) {
	srcUUID, perr := parseUUID(srcID)
	if perr != nil {
		return srcOwnerUUIDs{}, fmt.Errorf("parse src id: %w", perr)
	}
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return srcOwnerUUIDs{}, fmt.Errorf("parse owner id: %w", oerr)
	}
	return srcOwnerUUIDs{Src: srcUUID, Owner: ownerUUID}, nil
}

func insertNewLinks(
	ctx context.Context, q *dbq.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstIDs []string,
) error {
	for _, dstID := range dstIDs {
		if err := insertOneLink(ctx, q, srcUUID, ownerUUID, dstID); err != nil {
			return err
		}
	}
	return nil
}

func insertOneLink(
	ctx context.Context, q *dbq.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstID string,
) error {
	dstUUID, derr := parseUUID(dstID)
	if derr != nil {
		return fmt.Errorf("parse dst id %s: %w", dstID, derr)
	}
	if err := q.InsertPostLink(ctx, dbq.InsertPostLinkParams{
		SrcPostID: srcUUID, DstPostID: dstUUID, OwnerID: ownerUUID,
	}); err != nil {
		return fmt.Errorf("insert link: %w", err)
	}
	return nil
}

// BacklinksFor —— 列指向 dstID 的所有 (源 post slug, 源 post title)。
// 只列源 post 已 published（visitor 看不到草稿 backlink）。
func (r *PostLinkRepo) BacklinksFor(
	ctx context.Context, ownerID, dstID string,
) ([]PostLinkRef, error) {
	dstUUID, derr := parseUUID(dstID)
	if derr != nil {
		return nil, fmt.Errorf("parse dst id: %w", derr)
	}
	ownerUUID, oerr := parseUUID(ownerID)
	if oerr != nil {
		return nil, fmt.Errorf("parse owner id: %w", oerr)
	}
	rows, err := dbq.New(r.pool).ListBacklinksForPost(ctx, dbq.ListBacklinksForPostParams{
		DstPostID: dstUUID, OwnerID: ownerUUID,
	})
	if err != nil {
		return nil, fmt.Errorf("list backlinks: %w", err)
	}
	return mapLinkRefs(rows), nil
}

func mapLinkRefs(rows []dbq.ListBacklinksForPostRow) []PostLinkRef {
	out := make([]PostLinkRef, 0, len(rows))
	for i := range rows {
		out = append(out, PostLinkRef{Slug: rows[i].Slug, Title: rows[i].Title})
	}
	return out
}
