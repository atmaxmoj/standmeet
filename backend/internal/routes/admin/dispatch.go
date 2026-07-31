// dispatch.go —— admin 面从出站收口 wire 一条路由的通用件。
//
// 分工是固定的:**能力**来自收口(声明一次,MCP 面也拿同一份),**协议形状**留在这个面 ——
// 路径、方法、参数在 body 还是 path、成功回 200 带载荷还是 204 空身、错误怎么翻状态码,
// 都还是照常手写。收口不认识这些,它只给一个「入 JSON → 出 JSON / 错误」的函数。
//
// 于是新增一条 admin 路由的写法不变,只是能力的来源变了:不再直接 import 域的 facade
// (check-routes-via-dispatcher 会拦),而是 face.MustOp("resource.op")。

package admin

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// argsFrom —— 把一个 HTTP 请求翻成收口要的 args JSON。REST 把参数放在 body / path / query
// 的哪儿是本面的决定,这几个小函数就是那个决定的落点。
type argsFrom func(r *http.Request) (json.RawMessage, error)

// renderOK —— 成功时怎么回。带载荷回 200,还是空身回 204,是本面的决定。
type renderOK func(log logger, w http.ResponseWriter, body json.RawMessage)

// logger —— 只用到 Error 的窄口(handler 持的是 *slog.Logger)。
type logger interface {
	Error(msg string, args ...any) //nolint:forbidigo // slog 的签名就是 ...any
}

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

// queryArgs —— query string(?status=open)搬进 args JSON。缺省就是空串,
// 跟收口那边"空 = 不过滤"的约定一致。
func queryArgs(names ...string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		vals := map[string]string{}
		for _, n := range names {
			vals[n] = r.URL.Query().Get(n)
		}
		out, err := json.Marshal(vals)
		if err != nil {
			return nil, dispatcher.BadInput("invalid query parameters")
		}
		return out, nil
	}
}

// bodyWithURLParam —— body 里的字段 + 路径参数合成一份 args。REST 习惯把资源 id 放路径、
// 其余放 body(PATCH /x/{id} + {"status":...}),收口只认一份扁平 args,合并落在这儿。
func bodyWithURLParam(name string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		fields, err := decodeBodyFields(r)
		if err != nil {
			return nil, err
		}
		fields[name] = json.RawMessage(strconv.Quote(chi.URLParam(r, name)))
		out, merr := json.Marshal(fields)
		if merr != nil {
			return nil, dispatcher.BadInput("invalid request")
		}
		return out, nil
	}
}

// decodeBodyFields —— body 解成扁平字段表。空 body 合法(有些 PATCH 只靠路径参数),
// 解不动才是调用方给错了。服务端的 r.Body 永远非 nil(至多是 http.NoBody)。
func decodeBodyFields(r *http.Request) (map[string]json.RawMessage, error) {
	fields := map[string]json.RawMessage{}
	if err := json.NewDecoder(r.Body).Decode(&fields); err != nil && !errors.Is(err, io.EOF) {
		return nil, dispatcher.BadInput("invalid JSON body")
	}
	return fields, nil
}

// urlParamArgs —— 路径参数(/{id})搬进 args JSON 的那一格。
func urlParamArgs(name string) argsFrom {
	return func(r *http.Request) (json.RawMessage, error) {
		out, err := json.Marshal(map[string]string{name: chi.URLParam(r, name)})
		if err != nil {
			return nil, dispatcher.BadInput("invalid path parameter")
		}
		return out, nil
	}
}

// jsonOK —— 200 + 收口给的载荷原样写出(不解开重编:重编就是又造了一份形状)。
func jsonOK(log logger, w http.ResponseWriter, body json.RawMessage) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(body); err != nil {
		log.Error("write json", logErrKey, err)
	}
}

// noContent —— 204 空身。有些 admin 路由历史上就这么回,前端按这个契约写的。
func noContent(_ logger, w http.ResponseWriter, _ json.RawMessage) {
	w.WriteHeader(http.StatusNoContent)
}

// dispatchOp —— 从 Face 取能力 → 调 → 翻译。取不到 op 就在挂路由时炸(MustOp),
// 而不是运行时静悄悄少一条路由。
func (h *Handlers) dispatchOp(
	face *dispatcher.Face, id string, args argsFrom, render renderOK,
) http.HandlerFunc {
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
		render(h.Log, w, out)
	}
}

// writeOpError —— 收口只给协议无关的类别,状态码是本面的翻译:
// 调用方给错了 → 400,找不到 → 404,其余是这台机器的问题 → 500(细节进日志,不外泄)。
func (h *Handlers) writeOpError(w http.ResponseWriter, id string, err error) {
	switch {
	case dispatcher.IsBadInput(err):
		writeError(h.Log, w, envBadReq(err.Error()))
	case dispatcher.IsNotFound(err):
		writeError(h.Log, w, apierr.Envelope{
			Status: http.StatusNotFound, Code: "not_found", Message: err.Error(),
		})
	default:
		h.Log.Error("dispatcher op failed", "op", id, logErrKey, err)
		writeError(h.Log, w, serverErr())
	}
}
