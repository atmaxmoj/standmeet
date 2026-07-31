// from_dispatcher.go —— MCP 面 = 出站收口的**投影**(generated)。
//
// 走一遍 dispatcher 的操作,每个 Op 长成一个 MCP 工具。这里没有"工具清单"这种东西可以写漏 ——
// 面不是手写的,是长出来的。这正是 facade-parity 设计里 MCP 标 Generated 的含义:
// "there is no hand-written step to forget"。
//
// 收口不认识 MCP:Op.Invoke 收发 json.RawMessage,错误原样上抛。把它翻译成 MCP 的
// CallToolResult / isError 是**本面**的职责,就在这一处完成。

package mcphandle

import (
	"context"
	"encoding/json"
	"log/slog"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// MCPFace —— MCP 面在 parity 里的档案:服务 owner 的读和动作,承载不了浏览器流程、
// 明文密钥、multipart(它只走纯 JSON 工具调用)。
func MCPFace() fp.Facade {
	return fp.Facade{Name: "mcp", Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true}
}

// registerDispatcherOps —— 把收口里的每个操作挂成 MCP 工具。owner_id 解析 / panic recover /
// 结果翻译复用 wrapCapabilityHandler,跟 capreg 来的工具走同一条包装。
//
// 取 op 走 Face.Ops():**一次拿走全部,拿的同时就登记为已投影**。所以这个面既不可能漏挂一个
// op(没有手写清单),也不可能声称挂了却没挂(登记就是取用本身)。
func registerDispatcherOps(srv *server.MCPServer, d *dispatcher.Dispatcher, log *slog.Logger) {
	ops := d.Attach(MCPFace()).Ops()
	for i := range ops {
		tool := mcpgo.NewToolWithRawSchema(ops[i].ID, ops[i].Description, ops[i].InputSchema)
		srv.AddTool(tool, wrapCapabilityHandler(mcpHandlerFor(ops[i].Invoke), ops[i].ID, log))
	}
}

// mcpHandlerFor —— 协议无关的 Invoke → MCP 的 handler 形态。
// error → isError 错误结果;成功载荷原样透传(收口已经是 JSON)。
func mcpHandlerFor(invoke dispatcher.Invoke) capreg.MCPHandler {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) capreg.MCPResult {
		out, err := invoke(ctx, ownerID, raw)
		if err != nil {
			return capreg.MCPError(err.Error())
		}
		return capreg.MCPSuccess(string(out))
	}
}
