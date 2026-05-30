// tools_promote.go —— promote_to_wiki / promote_wiki_to_output post-process
// helpers + 共享的 optionalStringArg。拆出来守 tools.go 350 lines max-lines。

package mcp

import (
	"context"
	"errors"

	mcpgo "github.com/mark3labs/mcp-go/mcp"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

// promoteOpts —— promote_to_wiki / promote_wiki_to_output 共享的可选 post-process
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

// runPromote —— promote_to_wiki 主流程：promote → 可选 post-process
// (path + show_as_source) → 返 wiki id payload。
func runPromote(
	ctx context.Context, deps *Deps,
	in *usecases.PromoteInput, opts promoteOpts,
) *mcpgo.CallToolResult {
	wiki, err := usecases.PromoteToWiki(ctx, deps.Corpus, in)
	if err != nil {
		if errors.Is(err, domain.ErrRawNotFound) {
			return mcpgo.NewToolResultError("raw entry not found")
		}
		deps.Log.Error("mcp promote_to_wiki", "err", err)
		return mcpgo.NewToolResultError("promote_to_wiki failed")
	}
	if presult := applyWikiPromotePostProcess(ctx, deps, &wiki, opts); presult != nil {
		return presult
	}
	return marshalResult(deps, wikiIDPayload{WikiID: wiki.ID()})
}

// applyWikiPromotePostProcess —— promote 完后落 path（SEO repo）和
// show_as_source（admin update repo）；都是可选。path 失败走 SEO 错误
// envelope；show_as_source 失败不阻塞 promote 返回，写日志。
func applyWikiPromotePostProcess(
	ctx context.Context, deps *Deps, wiki *domain.Wiki, opts promoteOpts,
) *mcpgo.CallToolResult {
	if r := setWikiPathOpt(ctx, deps, wiki.ID(), opts.path); r != nil {
		return r
	}
	if opts.hideAsSource {
		hideWikiAsSource(ctx, deps, wiki)
	}
	return nil
}

func setWikiPathOpt(
	ctx context.Context, deps *Deps, wikiID string, path *string,
) *mcpgo.CallToolResult {
	if path == nil || *path == "" {
		return nil
	}
	if _, perr := deps.SEO.UpdateWikiPath(ctx, wikiID, path, "", false); perr != nil {
		return seoErrorResult(deps, perr, "promote_to_wiki set path")
	}
	return nil
}

func hideWikiAsSource(ctx context.Context, deps *Deps, wiki *domain.Wiki) {
	_, uerr := usecases.UpdateWiki(ctx, deps.Corpus, &usecases.UpdateWikiInput{
		OwnerID: wiki.OwnerID(), ID: wiki.ID(),
		Title: wiki.Title(), Body: wiki.Body(), Tags: wiki.Tags(),
		ParentID: ptrOrNil(wiki.ParentID), ShowAsSource: false,
	})
	if uerr != nil {
		deps.Log.Error("promote_to_wiki set show_as_source", "err", uerr)
	}
}
