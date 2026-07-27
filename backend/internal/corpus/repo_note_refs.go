// note_refs.go —— corpus `[[Title]]` 双链边表 CRUD（镜像 writing_refs，但 wiki 无
// slug：边按 wiki.id 存，返回 id + title，path 由 usecase 用 WikiTreePaths 算）。
//
// PromoteToWiki / UpdateWiki 同事务调 ReplaceRefsBySrcTx 重建 src 出度；public
// landing 调 BacklinksFor（入度=cited by）+ OutboundFor（出度=read next/sources）。

package corpus

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// NoteRefRepo —— note_refs 表 CRUD。
type NoteRefRepo struct {
	pool *pgstore.Pool
}

// NewNoteRefRepo 构造。
func NewNoteRefRepo(pool *pgstore.Pool) *NoteRefRepo { return &NoteRefRepo{pool: pool} }

// NoteRef —— 一条 backlink / outbound ref（目标 note 的 id + title）。path 由
// caller 用全树派生算（wiki 地址是树路径，不存）。
type NoteRef struct {
	ID    string
	Title string
}

// ReplaceRefsBySrcTx —— delete + insert 重建 src wiki 的出度。同写 wiki 行的 tx
// 内调。dstIDs 必须已去重 + 排除 self-link（caller 负责）。
func (*NoteRefRepo) ReplaceRefsBySrcTx(
	ctx context.Context, tx db.DBTX,
	srcID, ownerID string, dstIDs []string,
) error {
	ids, perr := parseSrcAndOwner(srcID, ownerID)
	if perr != nil {
		return perr
	}
	q := db.New(tx)
	if derr := q.DeleteNoteRefsBySrc(ctx, ids.Src); derr != nil {
		return fmt.Errorf("delete old wiki refs: %w", derr)
	}
	return insertNewNoteRefs(ctx, q, ids.Src, ids.Owner, dstIDs)
}

// ReplaceRefsBySrc —— 非事务版(wiki 写路径不在 tx 里)。边表是派生索引,delete +
// insert 直接走 pool(*pgstore.Pool 满足 db.DBTX)即可,不要求原子。caller 已去重 + 排 self。
func (r *NoteRefRepo) ReplaceRefsBySrc(
	ctx context.Context, srcID, ownerID string, dstIDs []string,
) error {
	return r.ReplaceRefsBySrcTx(ctx, r.pool, srcID, ownerID, dstIDs)
}

func insertNewNoteRefs(
	ctx context.Context, q *db.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstIDs []string,
) error {
	for _, dstID := range dstIDs {
		if err := insertOneNoteRef(ctx, q, srcUUID, ownerUUID, dstID); err != nil {
			return err
		}
	}
	return nil
}

func insertOneNoteRef(
	ctx context.Context, q *db.Queries,
	srcUUID, ownerUUID pgtype.UUID, dstID string,
) error {
	dstUUID, derr := pgstore.ParseUUID(dstID)
	if derr != nil {
		return fmt.Errorf("parse dst id %s: %w", dstID, derr)
	}
	if err := q.InsertNoteRef(ctx, db.InsertNoteRefParams{
		SrcID: srcUUID, DstID: dstUUID, OwnerID: ownerUUID,
	}); err != nil {
		return fmt.Errorf("insert wiki ref: %w", err)
	}
	return nil
}

// BacklinksFor —— 「cited by」：列指向 dstID 的源 wiki（id + title），只 published。
func (r *NoteRefRepo) BacklinksFor(
	ctx context.Context, ownerID, dstID string,
) ([]NoteRef, error) {
	ids, perr := parseSrcAndOwner(dstID, ownerID)
	if perr != nil {
		return nil, perr
	}
	rows, err := db.New(r.pool).ListWikiBacklinks(ctx, db.ListWikiBacklinksParams{
		DstID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		return nil, fmt.Errorf("list wiki backlinks: %w", err)
	}
	out := make([]NoteRef, 0, len(rows))
	for i := range rows {
		out = append(out, NoteRef{ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}

// AdminBacklinksFor —— owner 视角「cited by」：哪些 note 引用了 dst（任一 genre、含未发布）。
func (r *NoteRefRepo) AdminBacklinksFor(
	ctx context.Context, ownerID, dstID string,
) ([]NoteRef, error) {
	ids, perr := parseSrcAndOwner(dstID, ownerID)
	if perr != nil {
		return nil, perr
	}
	rows, err := db.New(r.pool).ListNoteBacklinksAll(ctx, db.ListNoteBacklinksAllParams{
		DstID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		return nil, fmt.Errorf("list note backlinks: %w", err)
	}
	out := make([]NoteRef, 0, len(rows))
	for i := range rows {
		out = append(out, NoteRef{ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}

// AdminOutboundFor —— owner 视角「read next」：src 引用了哪些 note（任一 genre、含未发布）。
func (r *NoteRefRepo) AdminOutboundFor(
	ctx context.Context, ownerID, srcID string,
) ([]NoteRef, error) {
	ids, perr := parseSrcAndOwner(srcID, ownerID)
	if perr != nil {
		return nil, perr
	}
	rows, err := db.New(r.pool).ListNoteOutboundAll(ctx, db.ListNoteOutboundAllParams{
		SrcID: ids.Src, OwnerID: ids.Owner,
	})
	if err != nil {
		return nil, fmt.Errorf("list note outbound: %w", err)
	}
	out := make([]NoteRef, 0, len(rows))
	for i := range rows {
		out = append(out, NoteRef{ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}

// OwnerNoteTitleRow —— 跨-genre 的 title→id（+genre）索引项，给 [[link]] 解析用。
type OwnerNoteTitleRow struct {
	ID    string
	Title string
	Genre string
}

// OwnerNoteTitles —— owner 语料全量（跨 genre）的 title/id，供 note refs 解析 `[[Title]]`。
func (r *NoteRefRepo) OwnerNoteTitles(
	ctx context.Context, ownerID string,
) ([]OwnerNoteTitleRow, error) {
	ownerUUID, perr := pgstore.ParseUUID(ownerID)
	if perr != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, perr)
	}
	rows, err := db.New(r.pool).ListAllOwnerNoteTitles(ctx, ownerUUID)
	if err != nil {
		return nil, fmt.Errorf("list owner note titles: %w", err)
	}
	out := make([]OwnerNoteTitleRow, 0, len(rows))
	for i := range rows {
		out = append(out, OwnerNoteTitleRow{
			ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title, Genre: rows[i].Genre,
		})
	}
	return out, nil
}

// OutboundFor —— 「read next / sources」：src 引用了哪些 wiki（id + title），只
// published。「N corpus sources」= len(返回)。
func (r *NoteRefRepo) OutboundFor(
	ctx context.Context, srcID string,
) ([]NoteRef, error) {
	srcUUID, perr := pgstore.ParseUUID(srcID)
	if perr != nil {
		return nil, fmt.Errorf("parse src id: %w", perr)
	}
	rows, err := db.New(r.pool).ListWikiOutbound(ctx, srcUUID)
	if err != nil {
		return nil, fmt.Errorf("list wiki outbound: %w", err)
	}
	out := make([]NoteRef, 0, len(rows))
	for i := range rows {
		out = append(out, NoteRef{ID: pgstore.FormatUUID(rows[i].ID), Title: rows[i].Title})
	}
	return out, nil
}
