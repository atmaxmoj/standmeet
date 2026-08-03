// diag_connector.go —— POST /internal/diag/connector/{id}/{invoke,agent-call}
//
// Owner-authed diag：直接打某个连接器（按 id，不经 active 槽）跑一件事，吐它原样的结果。
// 验 owner 刚传上来的那份绑定（response 抽取 / request 构造）端到端对不对——不经访客会话。
//
// **这一层不认识任何品类。** 它收三个字符串加一段不透明 JSON（品类、动词、入参），转交，
// 把回参原样吐回去。以前这里是三条路由 `/list-busy` `/create-event` `/send`，各自持一个
// typed 代理、各自把友好入参翻译成品类 DTO —— 于是**面**（路由层）知道了一次约会由
// summary/起止/时区/与会者构成、一封信由 to/subject/body 构成。名字删掉，形状还在。
//
// 正确的形状本来就摆在同一个文件里：`/agent-call` 一直是通用的（按 op + args 调）。
// 现在两条都是。品类知识搬去了调用方——它在内核外面。

package sys

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/middleware"
)

// ErrConnectorNotFound —— 这个 id 没注册,或者它不是所点品类的连接器。
//
// **这一层自己的 sentinel**,不是从连接器层借来的:借一个就得 import 那个包,而这条路由
// 唯一该知道的事就是"地址错了"还是"事没成"。组装根负责把连接器侧的对应错误翻成它
// (见 cmd/server/boot_wireup.go)。
var ErrConnectorNotFound = errors.New("connector not found")

// AgentCallFn —— 按 id 跑一个 agent-tool op（注入 auth 调 SaaS），回原始响应或错（diag 直验通路）。
type AgentCallFn func(
	ctx context.Context, id, ownerID, op string, args json.RawMessage,
) (json.RawMessage, error)

// CategoryInvokeFn —— 按 id 跑一个**品类动词**，回归一后的原始 JSON。品类和动词都是字符串：
// 这一层因此写不出任何品类专属的类型。
type CategoryInvokeFn func(
	ctx context.Context, ownerID, id, category, verb string, args json.RawMessage,
) (json.RawMessage, error)

// DiagConnectorDeps —— 直打某个连接器要的两条通路（组装根接上具体实现）。
type DiagConnectorDeps struct {
	Invoke    CategoryInvokeFn
	AgentCall AgentCallFn
	Log       *slog.Logger
}

// MountDiagConnector —— 挂连接器 diag（caller 已套 owner-session 中间件）。
func MountDiagConnector(r chi.Router, deps DiagConnectorDeps) {
	r.Post("/diag/connector/{id}/invoke", diagInvoke(deps))
	r.Post("/diag/connector/{id}/agent-call", diagAgentCall(deps))
}

type diagAgentCallReq struct {
	Op   string          `json:"op"`
	Args json.RawMessage `json:"args"`
}

// diagAgentCall —— owner 直跑一个 agent-tool（op）：注入 auth 调 SaaS，证运行时通路（§3 [A6]）。
// 成功 → 200 {ok:true}；运行失败 → 友好 200 {ok:false}（不泄底层，真错进日志）。
func diagAgentCall(deps DiagConnectorDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req diagAgentCallReq
		if !diagDecode(deps.Log, w, r, &req) {
			return
		}
		owner := middleware.OwnerIDFrom(r.Context())
		_, cerr := deps.AgentCall(r.Context(), chi.URLParam(r, "id"), owner, req.Op, req.Args)
		if cerr != nil {
			deps.Log.Warn("diag agent-call failed", "op", req.Op, "err", cerr)
			diagStatus(deps.Log, w, http.StatusOK, map[string]bool{"ok": false})
			return
		}
		diagStatus(deps.Log, w, http.StatusOK, map[string]bool{"ok": true})
	}
}

// diagInvokeReq —— 打哪个品类的哪个动词，入参原样透传。
type diagInvokeReq struct {
	Category string          `json:"category"`
	Op       string          `json:"op"`
	Args     json.RawMessage `json:"args"`
}

// diagInvokeResp —— 回参**原样**吐回（result 是连接器那一侧归一后的 JSON）。
// 这一层不重排、不改名、不格式化 —— 它看不懂里面是什么，也不该看懂。
//
// 失败时 Error 带上**真实原因**。diag 是 owner-authed 的诊断口，它存在的全部意义就是
// "告诉我为什么我这份绑定不通" —— 把原因藏进服务端日志，等于废掉这个端点。
// (对访客面的"不泄底层"要求不适用于这里:这一条只有 owner 打得到。)
//
// 字段序按指针宽度排 —— govet fieldalignment 管着。
type diagInvokeResp struct {
	Error  string          `json:"error,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	OK     bool            `json:"ok"`
}

// diagInvoke —— 直打某个连接器的一个品类动词。
//
// 连接器不存在 / 不是这个品类 → 404；跑失败 → 友好 200 {ok:false}（底层错进日志，
// 不泄给调用方 —— diag 也是一个面）。
func diagInvoke(deps DiagConnectorDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req diagInvokeReq
		if !diagDecode(deps.Log, w, r, &req) {
			return
		}
		if !req.complete() {
			diagStatus(deps.Log, w, http.StatusBadRequest,
				map[string]string{"error": "category and op are required"})
			return
		}
		runDiagInvoke(r.Context(), deps, w, chi.URLParam(r, "id"), &req)
	}
}

// complete —— 品类和动词都得给:这一层不认识任何品类,自然也补不出默认值。
func (q *diagInvokeReq) complete() bool { return q.Category != "" && q.Op != "" }

// runDiagInvoke —— 转交 + 翻回执。分支留在这儿,handler 只做解码和分派。
func runDiagInvoke(
	ctx context.Context, deps DiagConnectorDeps, w http.ResponseWriter,
	id string, req *diagInvokeReq,
) {
	out, err := deps.Invoke(ctx, middleware.OwnerIDFrom(ctx),
		id, req.Category, req.Op, argsOrEmpty(req.Args))
	if err != nil {
		diagInvokeErr(deps.Log, w, req.Category, req.Op, err)
		return
	}
	diagStatus(deps.Log, w, http.StatusOK, diagInvokeResp{OK: true, Result: out})
}

// argsOrEmpty —— 没带 args 就当空对象。有些动词（connected / 默认区间的探测）本来就不需要入参。
func argsOrEmpty(a json.RawMessage) json.RawMessage {
	if len(a) == 0 {
		return json.RawMessage(`{}`)
	}
	return a
}

// diagInvokeErr —— 分两种:"这个连接器不是这个品类"是地址错了(404);"跑失败了"是这次
// 调用没成(400 + 原因)。**原因照实回** —— 见 diagInvokeResp 的说明。
func diagInvokeErr(
	log *slog.Logger, w http.ResponseWriter, category, op string, err error,
) {
	if errors.Is(err, ErrConnectorNotFound) {
		diagStatus(log, w, http.StatusNotFound, map[string]string{"error": "connector not found"})
		return
	}
	log.Warn("diag invoke failed", "category", category, "op", op, "err", err)
	diagStatus(log, w, http.StatusBadRequest, diagInvokeResp{OK: false, Error: err.Error()})
}

// diagBody —— 这一层能解的两种请求体。`any` 在业务代码里是禁的:一个不透明的解码目标
// 等于放弃了"这条路由收什么"这件事的可读性。
type diagBody interface {
	*diagInvokeReq | *diagAgentCallReq
}

func diagDecode[T diagBody](log *slog.Logger, w http.ResponseWriter, r *http.Request, dst T) bool {
	if err := json.NewDecoder(r.Body).Decode(dst); err != nil {
		diagStatus(log, w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return false
	}
	return true
}

// diagPayload —— 这一层会吐的几种回参。同样不用 `any`。
type diagPayload interface {
	diagInvokeResp | map[string]string | map[string]bool
}

func diagStatus[T diagPayload](log *slog.Logger, w http.ResponseWriter, status int, v T) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Error("diag encode", "err", err)
	}
}
