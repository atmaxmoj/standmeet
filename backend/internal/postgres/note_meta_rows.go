// note_meta_rows.go —— wiki / output 的 ListAllMeta 共用的行映射。
//
// 两者只差 genre 和返回类型，行映射一模一样；`dupl` 在我给两边各加一个 owner_only 字段时当场
// 逮住了它们。一份映射两边共用 —— 同 waypointsFromRows 的理由：N 份副本改漏一份就是 F-R-1 那种
// 静默 bug，而这里改漏的后果是 **PII 出现在 sitemap 里**。

package postgres

import "github.com/atmaxmoj/standmeet/internal/postgres/dbq"

// allNoteMeta —— ListAllNoteMeta 的通用行形状（sitemap 枚举 + landing 的 title→path 索引）。
type allNoteMeta struct {
	ParentID  *string
	ID        string
	Title     string
	UpdatedAt int64
	Published bool
	// OwnerOnly —— 笔记级 owner 层：sitemap / landing 同样不能泄露一条 owner-only 笔记。
	OwnerOnly bool
}

func allNoteMetaFromRows(rows []dbq.ListAllNoteMetaRow) []allNoteMeta {
	out := make([]allNoteMeta, 0, len(rows))
	for i := range rows {
		out = append(out, allNoteMeta{
			ID: formatUUID(rows[i].ID), ParentID: optUUIDStr(rows[i].ParentID),
			Title: rows[i].Title, Published: rows[i].Published, OwnerOnly: rows[i].OwnerOnly,
			UpdatedAt: rows[i].UpdatedAt.Time.Unix(),
		})
	}
	return out
}
