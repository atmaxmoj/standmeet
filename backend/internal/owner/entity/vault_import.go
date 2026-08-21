// vault_import.go —— 「上一次 vault 导入」这个事实（UX-62）。
//
// 它住在 entity 而不是 repo 或 usecase：仓储写它、用例读它、路由把它渲成一句话，
// 三层说的必须是**同一个词**（[[vocabulary-must-not-diverge]]）。

package entity

import "time"

// VaultImportReceipt —— 上一次导入的回执。
//
// **Never 是时间的零值，不是计数的 0**：「从没导过」和「导过但零变更」是两件事，
// 而把它们说成同一句正是 UX-62 那条缺陷 —— 装着 1028 条笔记的实例和一个空实例，
// 在 /admin/obsidian 上长得一模一样。
type VaultImportReceipt struct {
	At      time.Time
	New     int
	Updated int
	Skipped int
}

// Never —— 从没导过。
func (r VaultImportReceipt) Never() bool { return r.At.IsZero() }
