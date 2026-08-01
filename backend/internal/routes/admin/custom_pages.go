// custom_pages.go —— GET /api/admin/custom-pages：owner 的 React 自定义页列表。
//
// 只有列表在这个面上。写（create / write_file / build / promote / rollback / delete）
// 是**故意**只在 MCP 上的：写一个页面就是写代码 + 驱动沙箱构建器，面板给不了这条路径。
// 那个决定写在 op 的 Reach 里（见 res_custom_pages.go），所以棘轮不会有一天"帮"它
// 长出一个 admin 孪生。
//
// 列表以前两个面不一样：这边带状态、live/staging 有没有、时间戳，MCP 那边只有
// id/slug/title。现在同一份。

package admin

import (
	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// CustomPagesDeps —— admin custom-pages handler 的能力来源。
type CustomPagesDeps struct {
	Face *dispatcher.Face
}

// MountCustomPages 挂 GET /custom-pages（只读视图）。
func (h *Handlers) MountCustomPages(r chi.Router) {
	r.Get("/custom-pages",
		h.dispatchOp(h.CustomPagesAdmin.Face, "custom_page.list", emptyArgs, jsonOK))
}
