// embeds.go —— /api/admin/embeds/*：owner 的 embed widget 配置（embed 规划 2026-09-01）。
// embed 指向 code，来源白名单住在 embed 上。全部经出站收口的同一个 dispatcher face 分派。

package admin

import "github.com/go-chi/chi/v5"

// paramEmbedID —— URL 路径参数名 == op 入参字段名（mergeURLParams 靠这个对齐）。
const paramEmbedID = "embed_id"

// MountEmbeds 挂 /embeds 子路由（caller 已经在 /embeds 前缀内）。
//
// 复用 CodesAdmin.Face：所有 owner 能力都经**同一个** dispatcher 分派（wire.AdminFace(Dispatch)），
// 这个 Face 按 op id 路由,"embeds.*" 跟 "codes.*" 走的是同一条收口。不为它再单开一个 dep 字段,
// 是因为那会是同一个值的第二份引用。
func (h *Handlers) MountEmbeds(r chi.Router) {
	face := h.CodesAdmin.Face
	r.Get("/", h.dispatchOp(face, "embeds.list", emptyArgs, jsonOK))
	r.Post("/", h.dispatchOp(face, "embeds.create", bodyArgs, jsonCreated))
	r.Patch("/{embed_id}",
		h.dispatchOp(face, "embeds.update", bodyWithURLParam(paramEmbedID), jsonOK))
	r.Delete("/{embed_id}",
		h.dispatchOp(face, "embeds.delete", urlParamArgs(paramEmbedID), jsonOK))
}
