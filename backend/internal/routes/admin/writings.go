// writings.go —— admin /writings:列出 / 建 / 改 / 发布 / 删。
//
// 建和改收 multipart:form field "data" 是 JSON,form field `file:<pending-id>` 是内联
// 图片的字节,正文里的占位是 `standmeet-asset:pending-<id>`。
//
// **这两条以前直连域**(自己调 corpus.SaveWriting、自己拼视图),因为收口没有携带字节的
// 通道。通道建好之后它们跟别的路由一样了:形状照常手写(multipart 怎么拆、什么状态码),
// 能力经 Face 取 —— 字节挂在这次调用上(见 dispatcher.WithFiles),op 那边跟 MCP 给的
// 一串地址合流。
//
// 树和分页那两条还直连(writings_tree.go):它们是面板独有的视图,没有对应的 op。

package admin

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// WritingsAdminDeps 的定义在 writings_tree.go —— 它剩下的那个域依赖(解素材地址)
// 只服务树 / 分页那两条视图路由,跟它们住在一起;保存这条已经不碰域了。

// opWritingSave —— 建和改是**同一个 op**:给了 writing_id 就是改。
const opWritingSave = "writing_create"

// MountWritings 挂 /writings 子路由。
func (h *Handlers) MountWritings(r chi.Router) {
	face := h.WritingsAdmin.Face
	save := h.saveWritingViaFace(face)
	r.Route("/writings", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "writings.list", emptyArgs, jsonOK))
		r.Get("/tree", h.treeWritings())
		r.Get("/page", h.pageWritings())
		r.Post("/", save(http.StatusCreated, ""))
		r.Patch("/{id}", save(http.StatusOK, "id"))
		r.Post("/{writing_id}/publish",
			h.dispatchOp(face, "writings.publish", urlParamArgs("writing_id"), jsonOK))
		r.Post("/{writing_id}/unpublish",
			h.dispatchOp(face, "writings.unpublish", urlParamArgs("writing_id"), jsonOK))
		r.Delete("/{writing_id}",
			h.dispatchOp(face, "writings.delete", urlParamArgs("writing_id"), noContent))
	})
}

// saveWritingViaFace —— 建 / 改共用一个处理器。idParam 空 = 建(URL 上没有 id)。
//
// 组装期就取好 op:这个面载不动字节的话立刻炸,而不是等 owner 点保存才回一个 404。
func (h *Handlers) saveWritingViaFace(
	face *dispatcher.Face,
) func(status int, idParam string) http.HandlerFunc {
	op := face.MustOpFiles(opWritingSave)
	invoke := op.Invoke
	return func(status int, idParam string) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			h.runWritingSave(w, r, &writingSaveCall{
				Invoke: invoke, Status: status, IDParam: idParam,
			})
		}
	}
}

// writingSaveCall —— 一次保存要的三样(避开 argument-limit)。
type writingSaveCall struct {
	Invoke  dispatcher.Invoke
	IDParam string
	Status  int
}

func (h *Handlers) runWritingSave(
	w http.ResponseWriter, r *http.Request, call *writingSaveCall,
) {
	parsed, perr := readWritingSave(w, r, call.IDParam)
	if perr != nil {
		writeError(h.Log, w, envBadReq(perr.Error()))
		return
	}
	// 字节随行:op 那边按 field 名 `file:<pending-id>` 跟正文里的占位对上。
	ctx := dispatcher.WithFiles(r.Context(), parsed.Files)
	out, err := call.Invoke(ctx, middleware.OwnerIDFrom(r.Context()), parsed.Data)
	if err != nil {
		h.writeOpError(w, opWritingSave, err)
		return
	}
	writeStatusBody(h.Log, w, call.Status, out)
}

// readWritingSave —— 拆信封 + 把 URL 上的 id 补进入参。返回的 Data 就是给 op 的那份。
func readWritingSave(
	w http.ResponseWriter, r *http.Request, idParam string,
) (parsedMultipart, error) {
	parsed, perr := parseWritingMultipart(w, r)
	if perr != nil {
		return parsedMultipart{}, perr
	}
	args, aerr := writingSaveArgs(parsed.Data, writingIDFrom(r, idParam))
	if aerr != nil {
		return parsedMultipart{}, aerr
	}
	parsed.Data = args
	return parsed, nil
}

// writingIDFrom —— 改的时候 id 在 URL 上(PATCH /writings/{id});建的时候没有。
func writingIDFrom(r *http.Request, param string) string {
	if param == "" {
		return ""
	}
	return chi.URLParam(r, param)
}
