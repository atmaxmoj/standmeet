// connectors_catalog.go —— 内置连接器目录路由（拆出来守 connectors.go 的 max-lines）。列出拉起时
// 外置装配进来的内置连接器，admin UI 据此渲染可连接的内置卡。

package admin

import "net/http"

// connectorCatalog —— 列内置连接器（外置装配进来的 manifest），admin UI 据此渲染可连接的内置卡。
// 跟 List（owner 已建）分开：内置混进 List 会被 reuse-by-category 的调用方误抓。状态/凭据表单各卡
// 再取 /{id}/{status,credential-form}，故这里只给 id/category/kind（复用 list 的行响应形）。
func (h *Handlers) connectorCatalog() http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		cat := h.ConnectorsAdmin.Svc.Catalog()
		rows := make([]connectorStatusResp, 0, len(cat))
		for i := range cat {
			rows = append(rows, statusRow(&cat[i]))
		}
		writeJSON(h.Log, w, connectorsListResp{Connectors: rows})
	}
}
