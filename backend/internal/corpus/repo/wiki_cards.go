// wiki_cards.go —— page-pin join 的 repo 面:按 id 集取被 pin 条目的卡内容
// (title / excerpt / published)。顺序由 usecase 按 pin 列表重排。

package repo

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// WikiCard —— 一条被 pin 条目的卡内容。Published 是渲染侧兜底过滤输入
// (不变量 pinned ⊆ published 由写入端维护)。
//
// Body 在这里,是因为卡上那句话**owner 没写就从正文派生**(F-L-47):真 vault 的 1047 条笔记
// excerpt 全空,同步不产生它。派生放在 usecase 那一层(repo 不决定显示什么),这里只负责把料带上。
type WikiCard struct {
	ID        string
	Title     string
	Excerpt   string
	Body      string
	Published bool
}

// ListCardsByIDs —— ids 集 → 卡内容 map(乱序;caller 按 pin 序取)。
// 未命中的 id 不在 map 里(条目已删 → caller 跳过)。
func (r *WikiRepo) ListCardsByIDs(
	ctx context.Context, ownerID string, ids []string,
) (map[string]WikiCard, error) {
	if len(ids) == 0 {
		return map[string]WikiCard{}, nil
	}
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	uuids, err := parsePinIDs(ids)
	if err != nil {
		return nil, err
	}
	rows, err := db.New(r.pool).ListNoteCardsByIDs(ctx, db.ListNoteCardsByIDsParams{
		OwnerID: ownerUUID, Column2: uuids,
	})
	if err != nil {
		return nil, fmt.Errorf("list note cards: %w", err)
	}
	return cardsFromRows(rows), nil
}

func cardsFromRows(rows []db.ListNoteCardsByIDsRow) map[string]WikiCard {
	out := make(map[string]WikiCard, len(rows))
	for i := range rows {
		id := pgstore.FormatUUID(rows[i].ID)
		out[id] = WikiCard{
			ID: id, Title: rows[i].Title, Excerpt: rows[i].Excerpt,
			Body: rows[i].Body, Published: rows[i].Published,
		}
	}
	return out
}

func parsePinIDs(ids []string) ([]pgtype.UUID, error) {
	uuids := make([]pgtype.UUID, 0, len(ids))
	for _, id := range ids {
		u, err := pgstore.ParseUUID(id)
		if err != nil {
			return nil, fmt.Errorf("parse pin id %q: %w", id, err)
		}
		uuids = append(uuids, u)
	}
	return uuids, nil
}
