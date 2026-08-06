// grep.go —— corpus_grep 的扫描面:owner 的每一条 note,连正文。
//
// 单独一个文件,因为它跟隔壁 vault_sync 那些"同步一条笔记"的读写是两件事:那边按 id / 路径
// 取一条,这边一次把全部正文端上来给一个正则扫。

package repo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// GrepNoteRow —— 扫描面的一条:leaf id + genre + path 段 + **正文**。
type GrepNoteRow struct {
	ID         string
	Genre      string
	Body       string
	PathTitles []string
}

// NotesWithBodies —— owner 的每一条 note,连正文。
//
// 没有分页也没有上限:never-miss 说的就是"在的一定找得到",而一个 cap 会把它悄悄换成
// "通常找得到"。语料的规模问题留给第二阶段的索引解决,不靠少读几条来解决。
func (r *VaultSyncRepo) NotesWithBodies(
	ctx context.Context, ownerID string,
) ([]GrepNoteRow, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).GrepCorpusNotes(ctx, owner)
	if qerr != nil {
		return nil, fmt.Errorf("grep corpus notes: %w", qerr)
	}
	out := make([]GrepNoteRow, 0, len(rows))
	for i := range rows {
		out = append(out, GrepNoteRow{
			ID:         pgstore.FormatUUID(rows[i].ID),
			Genre:      rows[i].Genre,
			Body:       rows[i].Body,
			PathTitles: rows[i].PathTitles,
		})
	}
	return out, nil
}

// NoteLang —— 一条笔记的身份语言 + 切换器标签。两者都可以没有(绝大多数笔记就是单语的)。
type NoteLang struct {
	Labels map[string]string
	Lang   string
}

// GetLang —— 读那两个 frontmatter 字段。best-effort:读不到就当没写(单语渲染),
// 一条笔记的语言标签值不了把一次阅读变成 500。
func (r *VaultSyncRepo) GetLang(ctx context.Context, ownerID, id string) NoteLang {
	ids, err := parseSrcAndOwner(id, ownerID)
	if err != nil {
		return NoteLang{}
	}
	row, qerr := db.New(r.pool).GetNoteLang(ctx, db.GetNoteLangParams{
		ID: ids.Src, OwnerID: ids.Owner,
	})
	if qerr != nil {
		return NoteLang{}
	}
	labels := map[string]string{}
	if uerr := json.Unmarshal(row.LangLabels, &labels); uerr != nil {
		labels = map[string]string{}
	}
	return NoteLang{Lang: row.Lang, Labels: labels}
}
