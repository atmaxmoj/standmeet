// ip_bans.go —— /api/admin/ip-bans/* —— owner 看 / 加 / 删封禁 IP（#58-4）。
// 公开面 enforcement 走 middleware.BanGuard（另一处）；这里只是 owner 的 CRUD。
// 配合 conversations.client_ip 的「IP 感知」：owner 在对话里看到来源 IP →
// 来这儿封掉。
//
// **第一条从出站收口 wire 的 admin 路由。** 路由形状、方法、路径、参数位置照常手写 ——
// REST 长什么样是这个面自己的决定。变的是能力的来源：handler 里不再握着 security 的仓储，
// 而是从 dispatcher 的 admin Face 取 Op。于是：
//
//   - 业务与校验只有一份（在收口里），MCP 面拿到的是同一个 Op，不会两边各写一套；
//   - 「这条路由服务了哪个能力」是收口记下的事实（取用即登记），parity 由结构回答，
//     不再需要一张手写对照表去事后对账。
//
// 这个面要做的只剩协议翻译：HTTP 请求 → args JSON，错误 → 400/500，载荷 → 响应体。

package admin

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// IPBansAdminDeps —— admin ip-bans 的能力来源：出站收口的 admin Face。
// 不再是仓储：这个面不该直接够到域。
type IPBansAdminDeps struct {
	Face *dispatcher.Face
}

// MountIPBans 挂 /ip-bans/* 子路由。
func (h *Handlers) MountIPBans(r chi.Router) {
	face := h.IPBansAdmin.Face
	r.Route("/ip-bans", func(r chi.Router) {
		r.Get("/", h.dispatchOp(face, "ip_bans.list", emptyArgs))
		r.Post("/", h.dispatchOp(face, "ip_bans.add", bodyArgs))
		r.Delete("/{id}", h.dispatchOp(face, "ip_bans.remove", urlParamArgs("id")))
	})
}

// argsFrom —— 把一个 HTTP 请求翻成收口要的 args JSON。REST 把参数放在 body / path / query
// 的哪儿是本面的决定，这几个小函数就是那个决定的落点。
type argsFrom func(r *http.Request) (json.RawMessage, error)

func emptyArgs(*http.Request) (json.RawMessage, error) {
	return json.RawMessage(`{}`), nil
}

func bodyArgs(r *http.Request) (json.RawMessage, error) {
	var raw json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return nil, dispatcher.BadInput("invalid JSON body")
	}
	return raw, nil
}

// urlParamArgs —— 路径参数（/{id}）搬进 args JSON 的那一格。
func urlParamArgs(name string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		return json.Marshal(map[string]string{name: chi.URLParam(r, name)})
	}
}

// dispatchOp —— 从 Face 取能力 → 调 → 翻译。取不到 op 就在挂路由时炸（MustOp），
// 而不是运行时静悄悄少一条路由。
func (h *Handlers) dispatchOp(face *dispatcher.Face, id string, args argsFrom) http.HandlerFunc {
	op := face.MustOp(id)
	return func(w http.ResponseWriter, r *http.Request) {
		in, aerr := args(r)
		if aerr != nil {
			writeError(h.Log, w, envBadReq(aerr.Error()))
			return
		}
		out, err := op.Invoke(r.Context(), middleware.OwnerIDFrom(r.Context()), in)
		if err != nil {
			h.writeOpError(w, id, err)
			return
		}
		writeRawJSON(h.Log, w, out)
	}
}

// writeOpError —— 收口只说「谁的错」，状态码是本面的翻译：调用方给错了 → 400，
// 其余是这台机器的问题 → 500（细节进日志，不外泄）。
func (h *Handlers) writeOpError(w http.ResponseWriter, id string, err error) {
	if dispatcher.IsBadInput(err) {
		writeError(h.Log, w, envBadReq(err.Error()))
		return
	}
	h.Log.Error("dispatcher op failed", "op", id, logErrKey, err)
	writeError(h.Log, w, serverErr())
}
