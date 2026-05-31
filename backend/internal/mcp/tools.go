// tools.go —— MCP 工具实现的共享小工具。
//
// E-1 之前曾承载 corpus 4 个 tool 的 wrapTool 实现 (raw_dump /
// promote_to_wiki / list_recent_raw / list_recent_wiki)，已全部迁到
// cap_corpus_raw.go (走 Capability + adapter)。本文件现在只剩老路径
// 其他 tools_*.go file 还在用的几个共享 helper。
//
// MCP 协议把"工具执行错误"通过 *CallToolResult.IsError=true 传回客户端，
// 而 Go handler 签名虽是 (result, error) 但 error 只在 transport 故障时返。
// 所以 handler 内部 invoke helper 全部返 *CallToolResult（错误 = NewToolResultError）；
// handler 自己一行调 helper 然后 `return result, nil`，避免被 nilerr linter
// 抓"if err != nil { return X, nil }" 模式。

package mcp

import (
	"context"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

const (
	defaultListLimit = 20
	mcpTimeFmt       = "2006-01-02T15:04:05Z"
)

// invokeFn —— 一个工具的"真"实现：输入 ctx + req，输出 result（错误也走 result）。
type invokeFn func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult

// wrapTool 把 invokeFn 适配成 mcp-go 的 ToolHandlerFunc 签名。
// handler 只一行 `return invoke(...), nil`，error 永远 nil（transport 没炸）。
func wrapTool(fn invokeFn) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		return fn(ctx, &req), nil
	}
}

// ptrOrNil —— domain 类型的 (string, bool) getter (例 Path / ParentID) →
// *string，给 JSON marshal 当 omitempty *string 字段用。
//
// closure 入参形态：caller 传方法引用 `rows[i].Path` 而不是 `rows[i].Path()`，
// 让 helper 内部统一 deref。这样 ptrOrNil 的签名是 (func) 而不是
// (string, bool)，避开 revive flag-parameter 的误判 —— 那条 lint 把 bool
// 参数当 control flag，对 Optional<string> 的 ok 部分是 false positive。
func ptrOrNil(get func() (string, bool)) *string {
	v, ok := get()
	if !ok {
		return nil
	}
	cp := v
	return &cp
}

// payload 接口规定每种 mcp tool 返回的 JSON payload 都有自己的 marshalJSON。
// 用 interface 把 marshal entry point 收敛在一处，避免 `any` 出现。
type payload interface {
	marshalJSON() ([]byte, error)
}

// marshalResult 序列化 payload 成 *CallToolResult；marshal 失败时返 error result。
func marshalResult(deps *Deps, p payload) *mcpgo.CallToolResult {
	b, err := p.marshalJSON()
	if err != nil {
		deps.Log.Error("mcp marshal payload", "err", err)
		return mcpgo.NewToolResultError(fmt.Sprintf("encode payload: %v", err))
	}
	return mcpgo.NewToolResultText(string(b))
}
