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
// Deleted —— 这一次剪掉了几条（F-L-62）。它跟另外三个数**不是一类**：新建/更新/未变都可逆,
// 剪枝不可逆。prod 上一次整份导入剪掉了一整棵子树 10 条笔记,而回执只报了另外三个数 ——
// 唯一不可逆的那一半没有数字。
type VaultImportReceipt struct {
	At      time.Time
	New     int
	Updated int
	Skipped int
	Deleted int
}

// Never —— 从没导过。
func (r VaultImportReceipt) Never() bool { return r.At.IsZero() }
