// obsidian_state.go —— 「上一次 vault 导入是什么时候」这一问的读面（UX-62）。
//
// 单独成文件不是为了凑行数（虽然 obsidian.go 确实到顶了）：导入/导出是**动作**，
// 这一条是**关于那些动作的事实**，两个读者不一样。

package admin

import (
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// vaultStateView —— 那一屏要的全部事实。
//
// `never` 是**独立的一位**，不是从计数推的：「从没导过」和「导过但零变更」是两件事，
// 而把它们说成同一句正是 UX-62 那条缺陷（1028 条笔记的实例跟空实例长得一样）。
type vaultStateView struct {
	LastImportAt string `json:"last_import_at"`
	New          int    `json:"new"`
	Updated      int    `json:"updated"`
	Skipped      int    `json:"skipped"`
	// Deleted —— 那一次剪掉了几条（F-L-62）。它跟另外三个数不是一类：那三个可逆，这个不可逆。
	Deleted int  `json:"deleted"`
	Never   bool `json:"never"`
}

func (h *Handlers) obsidianState() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rec, err := h.Obsidian.ImportReceipt.GetVaultImportReceipt(
			r.Context(), middleware.OwnerIDFrom(r.Context()),
		)
		if err != nil {
			h.Log.Error("read vault import receipt", logErrKey, err)
			http.Error(w, "could not read the vault state", http.StatusInternalServerError)
			return
		}
		// 形状就地拼：抽成 `vaultStateFrom(rec owner.VaultImportReceipt)` 会让**这个新文件**
		// 直接 import 域的 facade，而出站收口那道闸对新文件是零容忍的（老文件在基线里）。
		// 这里用 `:=` 收下回执，类型靠推导，不需要那个 import。
		view := vaultStateView{
			New: rec.New, Updated: rec.Updated, Skipped: rec.Skipped,
			Deleted: rec.Deleted, Never: rec.Never(),
		}
		if !rec.Never() {
			view.LastImportAt = rec.At.UTC().Format(time.RFC3339)
		}
		writeJSON(h.Log, w, view)
	}
}
