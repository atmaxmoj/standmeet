// genres.go —— corpus_notes.genre 的五个判别值的**唯一定义处**。五 genre 平级(raw / wiki /
// output / writing / subjectivity),放一起只是同一个枚举的一处来源,彼此没有特别的分组/配对关系。
// (之前散在 wiki.go / output.go / corpus_tree.go 三处,还误导性地把 raw+writing 凑一块。)
//
// 与 DocumentGenre 逐字对齐。subjectivity 之前不在这里 —— 这层就"少了一个 genre",
// 于是它没有 tree、没有 admin 列表,owner 连自己的 CV 在哪都看不见(F-A-15)。

package repo

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

const (
	genreRaw          = "raw"
	genreWiki         = "wiki"
	genreOutput       = "output"
	genreWriting      = "writing"
	genreSubjectivity = "subjectivity"
)

// listNoteMetaBy —— wiki/output 的 ListAllMeta 共用体：按 genre 拉全量 note meta
// 行，用 mk 把每行映射成各自的 Meta 类型（去重两处近乎一致的实现，dupl-clean）。
func listNoteMetaBy[T any](
	ctx context.Context, pool *pgstore.Pool, ownerID, genre string,
	mk func(*db.ListAllNoteMetaRow) T,
) ([]T, error) {
	ownerUUID, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(pool).ListAllNoteMeta(ctx, db.ListAllNoteMetaParams{
		OwnerID: ownerUUID, Genre: genre,
	})
	if qerr != nil {
		return nil, fmt.Errorf("list all %s meta: %w", genre, qerr)
	}
	out := make([]T, 0, len(rows))
	for i := range rows {
		out = append(out, mk(&rows[i]))
	}
	return out, nil
}
