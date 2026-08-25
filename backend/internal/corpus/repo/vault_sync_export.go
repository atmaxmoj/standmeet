// vault_sync_export.go —— **把语料读出去给 vault** 的那一半。
//
// 跟 vault_sync.go 分开，不是为了让那个文件短一点：那边做的是「把一次 sync 对账进来」
// （认领、reconcile、web-wins、prune），这边只做一件事 —— 一次性把 owner 的全部 corp note
// 取出来，交给 obsidian 渲染成 .md。两边的读法本来就不同：对账按 title / source_path 一条条
// 认领，导出要的是**整棵树加上每条笔记的全部字段**。
//
// 而「全部字段」这句话在这里一直是假的（F-L-67）：`excerpt` / `css_classes` / `lang_labels`
// 三个列在库里躺着，这条读取从来没取过，于是 owner 同步下来就少了它们。上一次修同一个形状
// （F-L-59，lang/aliases）时那条 SELECT 的注释已经写下了正确的道理 ——「丢失从这条 SELECT
// 开始，不是从渲染开始」—— 只是没有扫到邻居。

package repo

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/corpus/db"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// ListAllForExport —— owner 所有 corp note(任一 genre),给 vault export 反向渲染成 .md。
func (r *VaultSyncRepo) ListAllForExport(ctx context.Context, ownerID string) ([]SyncNote, error) {
	owner, err := pgstore.ParseUUID(ownerID)
	if err != nil {
		return nil, fmt.Errorf(pgstore.ErrParseOwnerIDPrefix, err)
	}
	rows, qerr := db.New(r.pool).ListAllNotesForExport(ctx, owner)
	if qerr != nil {
		return nil, fmt.Errorf("list notes for export: %w", qerr)
	}
	out := make([]SyncNote, 0, len(rows))
	for i := range rows {
		sn := SyncNote{
			ID: pgstore.FormatUUID(rows[i].ID), Genre: rows[i].Genre, Title: rows[i].Title,
			Body: rows[i].Body, Published: rows[i].Published, Tags: rows[i].Tags,
			Lang: rows[i].Lang, Aliases: rows[i].Aliases,
			Excerpt: rows[i].Excerpt, CSSClasses: rows[i].CssClasses,
			LangLabels:  decodeLangLabels(rows[i].LangLabels),
			SourcePath:  rows[i].ObsidianSourcePath,
			Frontmatter: rows[i].ObsidianFrontmatter,
		}
		if rows[i].ParentID.Valid {
			sn.ParentID = pgstore.FormatUUID(rows[i].ParentID)
		}
		out = append(out, sn)
	}
	return out, nil
}

// decodeLangLabels —— `lang_labels` jsonb → map。解不开就当没有：这一列是**呈现用的标签**
// （码 → 切换器上显示的字），坏掉一条不该让整次导出失败，缺了按码生成就是它本来的降级路径。
func decodeLangLabels(raw []byte) map[string]string {
	labels := map[string]string{}
	if len(raw) == 0 {
		return labels
	}
	if err := json.Unmarshal(raw, &labels); err != nil {
		return map[string]string{}
	}
	return labels
}
