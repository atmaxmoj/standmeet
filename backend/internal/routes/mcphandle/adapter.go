// adapter.go —— Phase B-4: 把 capreg.MCPBinding 绑到 mcp-go server。
//
// 每个 capability 实现 OwnerMCPBinding 返一份 {Name, Description,
// InputSchema, Handler}；本 adapter 统一做 owner_id resolve + panic recover
// + result translation；Handler 拿到的 ownerID 已经验过、raw 是 args JSON。

package mcphandle

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"runtime/debug"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
)

// PanicResultMarker —— handler panic 后返给客户端的错误前缀。导出是给守卫用:
// e2e 逐个调用每个 owner 工具,靠这个标记把"工具崩了"跟"工具正常拒绝了空入参"分开。
// 没有它,两者都只是一条 isError,守卫就成了睁眼瞎。
const PanicResultMarker = "internal error: capability handler panicked"

// registerCapabilities —— walk registry.OwnerMCPBindings() 把每个 binding
// 装进 mcp-go server。corpus / page / job-loop 等若也有 MCP 面，自动出现
// 在 owner MCP 的 tools/list。
func registerCapabilities(srv *server.MCPServer, reg *capreg.Registry, log *slog.Logger) {
	for _, b := range reg.OwnerMCPBindings() {
		mcpTool := mcpgo.NewToolWithRawSchema(b.Name, b.Description, b.InputSchema)
		srv.AddTool(mcpTool, wrapCapabilityHandler(b.Handler, b.Name, log))
	}
}

// wrapCapabilityHandler —— 标准的 owner-side MCP 执行包装：
//   - panic recover (handler bug 不该 take down 整个 MCP server)
//   - owner_id resolve (HTTPContextFunc 已经塞 ctx，这里取出)
//   - args JSON marshal (mcp-go 拿到 map[string]any，统一序列化成 raw 给 Handler)
//   - MCPResult → *CallToolResult 翻译
func wrapCapabilityHandler(
	h capreg.MCPHandler, toolName string, log *slog.Logger,
) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		// 结果用闭包变量接,recover 里改写它 —— 本仓库禁具名返回值,而"panic 后仍要返回
		// 一个结果"必须有个地方落。原来只 log 不赋值,panic 后函数返回 (nil, nil):owner 的
		// MCP 客户端收到"成功但空",崩掉的工具跟"这个工具本来就没输出"长得一模一样。
		var out *mcpgo.CallToolResult
		func() {
			defer func() {
				if r := recover(); r != nil {
					log.Error("mcp capability handler panic",
						"tool", toolName, "panic", r, "stack", string(debug.Stack()))
					out = mcpgo.NewToolResultError(PanicResultMarker + ": " + toolName)
				}
			}()
			out = runCapabilityHandler(ctx, h, &req)
		}()
		return out, nil
	}
}

func runCapabilityHandler(
	ctx context.Context, h capreg.MCPHandler, req *mcpgo.CallToolRequest,
) *mcpgo.CallToolResult {
	ownerID := OwnerIDFrom(ctx)
	if ownerID == "" {
		return mcpgo.NewToolResultError("unauthorized: invalid or missing api token")
	}
	raw, mErr := marshalToolArgs(req.GetArguments())
	if mErr != nil {
		return mcpgo.NewToolResultError("invalid arguments: " + mErr.Error())
	}
	result := h(ctx, ownerID, raw)
	if !result.OK {
		return mcpgo.NewToolResultError(result.Text)
	}
	if len(result.Embeddings) == 0 {
		return mcpgo.NewToolResultText(result.Text)
	}
	return buildMultiContentResult(&result)
}

// buildMultiContentResult —— text + N binary embed → CallToolResult。E-12 起
// applications.commit 用 (text JSON + PDF blob)。
func buildMultiContentResult(r *capreg.MCPResult) *mcpgo.CallToolResult {
	content := make([]mcpgo.Content, 0, 1+len(r.Embeddings))
	content = append(content,
		mcpgo.TextContent{Type: mcpgo.ContentTypeText, Text: r.Text})
	for i := range r.Embeddings {
		e := &r.Embeddings[i]
		content = append(content, mcpgo.NewEmbeddedResource(mcpgo.BlobResourceContents{
			URI:      e.URI,
			MIMEType: e.MIMEType,
			Blob:     base64.StdEncoding.EncodeToString(e.Blob),
		}))
	}
	return &mcpgo.CallToolResult{Content: content}
}

func marshalToolArgs(args map[string]any) (json.RawMessage, error) {
	if len(args) == 0 {
		return json.RawMessage(`{}`), nil
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, fmt.Errorf("marshal tool args: %w", err)
	}
	return raw, nil
}
