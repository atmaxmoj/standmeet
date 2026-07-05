// capreg_booker_socket.go —— 归一(#144): booker 的 HOST 侧 compute plumbing。
//
// 外置的 booker 插件（沙箱、断网）经 bind 进来的 unix socket 调这两个 op：
//   - "list_slots" → runBookerListSlots（freebusy + policy 枚举空档）
//   - "book"       → runBookerBook（policy → freebusy → insert → 落库 → 约成通知）
//
// 都跑跟旧内建一样的逻辑、返同一套 wire（{ok,...}）。session 上下文（owner/code/
// conversation/visitor/role）由 host 经 tool-call `_meta` 递给插件、插件再转进 socket
// 请求 —— 不在 LLM args 里，防伪造。owner 时区由 handler 用 Owners 自查（不进 _meta）。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
)

// bookerSockReq —— 插件经 socket 发来的请求。session 字段 + 原样转发的 tool args。
type bookerSockReq struct {
	OwnerID        string          `json:"owner_id"`
	CodeID         string          `json:"code_id"`
	ConversationID string          `json:"conversation_id"`
	VisitorName    string          `json:"visitor_name"`
	VisitorEmail   string          `json:"visitor_email"`
	RoleID         string          `json:"role_id"`
	Args           json.RawMessage `json:"args"`
}

// RegisterBookerSocket —— 把 booker 的 op 注册到 capsocket server。
func RegisterBookerSocket(srv *capsocket.Server, deps *BookerDeps) {
	srv.Handle("book", bookerOpHandler(deps, runBookerBook))
	srv.Handle("list_slots", bookerOpHandler(deps, runBookerListSlots))
	srv.Handle("send_confirmation", bookerOpHandler(deps, runBookerSendConfirmation))
	srv.Handle("cancel", bookerOpHandler(deps, runBookerCancel))
	srv.Handle("reschedule", bookerOpHandler(deps, runBookerReschedule))
}

// bookerOpHandler —— 两个 op 同形：解 session + args、查 owner 时区、跑 run（book /
// list_slots），把 run 返的 wire JSON 字符串原样回去。run 返的就是给 agent 的 result
// （含错误也是 {ok:false,...}），所以 handler 自身几乎不产生 error（只在解码 / owner
// 查询硬失败时返 error，由 capsocket 折成 {"error":...}）。
func bookerOpHandler(
	deps *BookerDeps,
	run func(context.Context, *BookerDeps, *bookerCallInput, []byte) (string, error),
) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req bookerSockReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("booker req: %w", err)
		}
		ci, cerr := deps.bookerCallInputFrom(ctx, &req)
		if cerr != nil {
			return nil, cerr
		}
		out, rerr := run(ctx, deps, ci, req.Args)
		if rerr != nil {
			return nil, rerr
		}
		return json.RawMessage(out), nil
	}
}

// bookerCallInputFrom —— 把 socket 请求的 session 字段 + 自查的 owner 时区拼成
// bookerCallInput。owner 查不到 → 真错（policy 评估缺时区会算错，宁可显式失败）。
func (deps *BookerDeps) bookerCallInputFrom(
	ctx context.Context, req *bookerSockReq,
) (*bookerCallInput, error) {
	owner, oerr := deps.Owners.GetByID(ctx, req.OwnerID)
	if oerr != nil {
		return nil, fmt.Errorf("booker: load owner: %w", oerr)
	}
	return &bookerCallInput{
		OwnerID:        req.OwnerID,
		OwnerTZ:        owner.ProfileTimezone,
		CodeID:         req.CodeID,
		ConversationID: req.ConversationID,
		VisitorName:    req.VisitorName,
		VisitorEmail:   req.VisitorEmail,
		RoleID:         req.RoleID,
	}, nil
}
