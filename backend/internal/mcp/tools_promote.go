// tools_promote.go —— promote_wiki_to_output 还在用的 promoteOpts +
// readPromoteOpts + optionalStringArg。
//
// E-1 之前 promote_to_wiki post-process (runPromote / applyWikiPromotePostProcess /
// setWikiPathOpt / hideWikiAsSource) 也住在这里；那批已删，promote_to_wiki
// 由 cap_corpus_raw.go 自己 apply post-process。promote_wiki_to_output
// 走 runPromoteToOutput (tools_output.go) 还在用这里的 readPromoteOpts。

package mcp

import (
	mcpgo "github.com/mark3labs/mcp-go/mcp"
)

// promoteOpts —— promote_wiki_to_output 共享的可选 post-process
// 入参：path + show_as_source。包成 struct 避开 revive 的 flag-parameter 报。
type promoteOpts struct {
	path         *string
	hideAsSource bool
}

// optionalStringArg —— 从 MCP args 拿 string，空 → nil（让 caller 区分
// "owner 没传" 和 "owner 显式传空"）。
func optionalStringArg(req *mcpgo.CallToolRequest, key string) *string {
	s := req.GetString(key, "")
	if s == "" {
		return nil
	}
	return &s
}

// readPromoteOpts —— 从 MCP request 提 path + show_as_source；show_as_source
// 默认 true，只显式 false 才触发 post-process。
func readPromoteOpts(req *mcpgo.CallToolRequest) promoteOpts {
	v, hasShow := req.GetArguments()["show_as_source"]
	hide := false
	if hasShow {
		b, ok := v.(bool)
		hide = ok && !b
	}
	return promoteOpts{
		path:         optionalStringArg(req, "path"),
		hideAsSource: hide,
	}
}
