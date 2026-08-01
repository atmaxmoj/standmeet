// res_seo_entry.go —— 一条条目的公开状态(wiki / output 同一件事,genre 是参数)。

package dispatcher

// EntrySEO —— 改一条条目的公开开关 + 摘要。Genre 取 wiki / output。
type EntrySEO struct {
	OwnerID   string
	Genre     string
	EntryID   string
	Excerpt   string
	Published bool
}

// EntrySEOResult —— 更新后的条目,外加因为取消公开而被自动摘掉的主页栏目。
// 摘 pin 是副作用,所以当面报给 owner(pinned ⊆ published 的那一端)。
type EntrySEOResult struct {
	ID        string
	Genre     string
	Excerpt   string
	Unpinned  []string
	Published bool
}
