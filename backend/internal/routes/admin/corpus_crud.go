// corpus_crud.go —— 一条语料的详情 / 改 / 删 / 提升,genre 走路径参数。
//
// 路由表:
//   GET    /corpus/{genre}/{id}          —— 详情(含 body 和 outbound/backlinks)
//   PATCH  /corpus/{genre}/{id}          —— 改
//   DELETE /corpus/{genre}/{id}          —— 删(raw 是归档;subjectivity 也走这条)
//   POST   /corpus/{genre}/{id}/promote  —— 提升一步(genre 说的是**源**)
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
}
