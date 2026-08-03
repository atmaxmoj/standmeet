// corpus_crud.go —— 一条语料的详情 / 改 / 删 / 提升,genre 走路径参数。
//
// 路由表:
//   GET    /corpus/{genre}/{id}          —— 详情(含 body 和 outbound/backlinks)
//   PATCH  /corpus/{genre}/{id}          —— 改
//   DELETE /corpus/{genre}/{id}          —— 删(raw 是归档;subjectivity 也走这条)
//   POST   /corpus/{genre}/{id}/promote  —— 提升一步(genre 说的是**源**)
//   POST   /corpus/{genre}/{id}/assets   —— 挂一份素材(图 / 附件 / hero 图)
//
// 能力全部经收口取,这一层只有 REST 形状:删回 204(前端按这个契约写的),其余回 200。

package admin

import (
	"github.com/go-chi/chi/v5"
)

// MountCorpusCRUD —— 一条语料上的四件事。create 归 MountCorpus 的 POST /corpus/{genre}。
// caller 已包 /api/admin。
func (h *Handlers) MountCorpusCRUD(r chi.Router) {
	face := h.Corpus.Face
	r.Get("/corpus/{genre}/{id}", h.dispatchOp(face, "corpus.get", corpusIDArgs, jsonOK))
	r.Patch("/corpus/{genre}/{id}",
		h.dispatchOp(face, "corpus.update", corpusEntryArgs, jsonOK))
	r.Delete("/corpus/{genre}/{id}",
		h.dispatchOp(face, "corpus.delete", corpusIDArgs, noContent))
	r.Post("/corpus/{genre}/{id}/promote",
		h.dispatchOp(face, "corpus.promote", corpusEntryArgs, jsonOK))
	// 素材挂在一条语料下面,所以地址也挂在它下面。两条来路同一个地址:JSON 交一个 https
	// 地址(服务端自己去取,owner 通过 AI 的用法),multipart 交字节(面板上的文件挑选框)。
	// 分流在 corpus_assets.go。
	r.Post("/corpus/{genre}/{id}/assets", h.attachCorpusAsset())
	r.Delete("/corpus/{genre}/{id}/assets/{asset_id}",
		h.dispatchOp(face, "assets.delete", corpusAssetArgs, noContent))
}
