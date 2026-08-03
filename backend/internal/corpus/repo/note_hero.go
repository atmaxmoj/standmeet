// note_hero.go —— 一条 corpus note 的 hero 区,以及正文(里面的素材引用)。
//
// **跨 genre**:素材这件事对 genre 是无差别的 —— 一条 raw 和一篇 writing 挂图的方式一样。
// cover_image_asset_id / cover_headline / cover_hue 三列本来就在共享的 corpus_notes 表上,
// 以前只有 writing 那条路写它们,于是"每个 genre 都能有 hero"这句话在数据上成立、在代码里
// 不成立。

package repo

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// NoteHeroRepo —— 任意 genre 的一条 note 上的 hero 区。
type NoteHeroRepo struct {
	pool *pgstore.Pool
}

// NewNoteHeroRepo 构造。
func NewNoteHeroRepo(pool *pgstore.Pool) *NoteHeroRepo { return &NoteHeroRepo{pool: pool} }

// Get —— 读一条 note 的正文 + hero 三件套。不存在 / 不是这个 owner 的 → ErrEntryNotFound。
func (r *NoteHeroRepo) Get(ctx context.Context, ownerID, noteID string) (entity.NoteHero, error) {
	ids, perr := heroIDs(ownerID, noteID)
	if perr != nil {
		return entity.NoteHero{}, perr
	}
	row, err := db.New(r.pool).GetNoteHero(ctx, db.GetNoteHeroParams{
		ID: ids.note, OwnerID: ids.owner,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.NoteHero{}, entity.ErrEntryNotFound
		}
		return entity.NoteHero{}, fmt.Errorf("get note hero: %w", err)
	}
	return entity.NoteHero{
		Body:          row.Body,
		CoverAssetID:  pgstore.FormatUUID(row.CoverImageAssetID),
		CoverHeadline: row.CoverHeadline,
		CoverHue:      row.CoverHue,
	}, nil
}

// Set —— 整份写回 hero 三件套。**调用方负责先 Get 再只覆盖这次给了的那几项** ——
// 三列一次写全,所以没提到的字段必须由调用方带着现值回来,否则会被顺手抹掉。
func (r *NoteHeroRepo) Set(ctx context.Context, ownerID, noteID string, h *entity.NoteHero) error {
	ids, perr := heroIDs(ownerID, noteID)
	if perr != nil {
		return perr
	}
	cover, cerr := optionalAssetUUID(h.CoverAssetID)
	if cerr != nil {
		return cerr
	}
	_, err := db.New(r.pool).SetNoteHero(ctx, db.SetNoteHeroParams{
		ID: ids.note, OwnerID: ids.owner, CoverImageAssetID: cover,
		CoverHeadline: h.CoverHeadline, CoverHue: h.CoverHue,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return entity.ErrEntryNotFound
		}
		return fmt.Errorf("set note hero: %w", err)
	}
	return nil
}

// heroIDs —— 两个 id 一起解析,省得每处写两遍。
type heroIDPair struct{ note, owner pgtype.UUID }

func heroIDs(ownerID, noteID string) (heroIDPair, error) {
	noteUUID, nerr := pgstore.ParseUUID(noteID)
	if nerr != nil {
		return heroIDPair{}, entity.ErrEntryNotFound
	}
	ownerUUID, oerr := pgstore.ParseUUID(ownerID)
	if oerr != nil {
		return heroIDPair{}, fmt.Errorf("parse owner id: %w", oerr)
	}
	return heroIDPair{note: noteUUID, owner: ownerUUID}, nil
}

// optionalAssetUUID —— 空串 = 摘掉 hero 图(写 NULL)。
func optionalAssetUUID(id string) (pgtype.UUID, error) {
	if id == "" {
		return pgtype.UUID{}, nil
	}
	u, err := pgstore.ParseUUID(id)
	if err != nil {
		return pgtype.UUID{}, entity.ErrAssetNotFound
	}
	return u, nil
}
