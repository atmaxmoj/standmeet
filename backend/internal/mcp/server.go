// Package mcp 提供 owner 的 AI 客户端用的 MCP server。
//
// Auth：Bearer API token（mcp:write/mcp:read/mcp:pages 在 v1 不分粒度，所有
// token 一视同仁）。token 校验通过 HTTPContextFunc 注 ownerID 到 ctx，tool
// handler 从 ctx 取。
//
// Transport：mcp-go 的 streamable HTTP。/mcp/ 同 endpoint 处理 POST request +
// 可选 SSE。
package mcp

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

type ctxKey struct{ name string }

var ctxKeyOwnerID = ctxKey{name: "mcpOwnerID"}

// Deps —— MCP server 需要的业务依赖。
type Deps struct {
	APITokens     usecases.APITokenDeps
	Jobs          usecases.JobsDeps
	Owners        OwnerLookup
	Corpus        usecases.CorpusDeps
	SEO           SEOWriter
	CustomPages   usecases.CustomPageDeps
	Resume        usecases.ResumeDeps
	Log           *slog.Logger
	Applications  usecases.ApplicationsDeps
	Conversations usecases.ConversationsDeps
	Skills        usecases.SkillsDeps
	MCPServers    usecases.MCPServersDeps
	Writings      usecases.WritingsDeps
	WritingsTx    usecases.WritingsTxDeps
}

// SEOWriter —— seo.* MCP tools 需要的最小接口（避开直接 import postgres.SEORepo）。
type SEOWriter interface {
	UpdateWikiPath(
		ctx context.Context, wikiID string,
		path *string, description string, indexed bool,
	) (domain.WikiEntry, error)
	UpdateOutputPath(
		ctx context.Context, outputID string,
		path *string, description string, indexed bool,
	) (domain.OutputEntry, error)
	GetSettings(ctx context.Context, ownerID string) (domain.SEOSettings, error)
	UpsertSettings(ctx context.Context, in *domain.SEOSettings) (domain.SEOSettings, error)
}

// OwnerLookup 是 MCP 工具调用时按 ownerID 取 owner profile 的最小接口
// （避免直接 import postgres.OwnerRepo 让 lint 报 component 越权）。
type OwnerLookup interface {
	GetByID(ctx context.Context, ownerID string) (domain.Owner, error)
}

// New 构造一个挂好工具的 http.Handler，调用方挂到 /mcp/* 路由。
func New(deps *Deps) http.Handler {
	mcpSrv := server.NewMCPServer(
		"standmeet",
		"0.1.0",
		server.WithToolCapabilities(true),
	)
	registerTools(mcpSrv, deps)

	httpSrv := server.NewStreamableHTTPServer(
		mcpSrv,
		server.WithHTTPContextFunc(authContextFunc(deps)),
		server.WithEndpointPath("/mcp"),
	)
	return httpSrv
}

// authContextFunc 在 mcp-go HTTP layer 拦每个请求，验 Bearer token，把 owner_id
// 注 ctx。失败时把 sentinel 错误也注 ctx，tool handler 看到就返回 error 给 MCP
// client（mcp-go 没提供"在 HTTP 层直接返 401"的钩子，只能在 tool 层 short-circuit）。
func authContextFunc(deps *Deps) server.HTTPContextFunc {
	return func(ctx context.Context, r *http.Request) context.Context {
		token := bearerFromHeader(r.Header.Get("Authorization"))
		ownerID, err := usecases.VerifyAPIToken(ctx, deps.APITokens, token)
		if err != nil {
			return ctx // tool handler 取不到 ownerID 时返 unauthorized
		}
		return context.WithValue(ctx, ctxKeyOwnerID, ownerID)
	}
}

func bearerFromHeader(h string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(h, prefix) {
		return ""
	}
	return strings.TrimSpace(strings.TrimPrefix(h, prefix))
}

// OwnerIDFrom 从 ctx 取 owner_id；tool handler 用。空字符串表示未鉴权。
func OwnerIDFrom(ctx context.Context) string {
	v, ok := ctx.Value(ctxKeyOwnerID).(string)
	if !ok {
		return ""
	}
	return v
}

// registerTools 把所有 tool 注册到 mcpSrv。
func registerTools(mcpSrv *server.MCPServer, deps *Deps) {
	mcpSrv.AddTool(meTool(), wrapTool(invokeMe(deps)))
	corpusTools(mcpSrv, deps)
	outputTools(mcpSrv, deps)
	seoTools(mcpSrv, deps)
	customPageTools(mcpSrv, deps)
	jobsTools(mcpSrv, deps)
	resumeTools(mcpSrv, deps)
	applicationsTools(mcpSrv, deps)
	chatTools(mcpSrv, deps)
	skillsTools(mcpSrv, deps)
	mcpServersTools(mcpSrv, deps)
	writingsTools(mcpSrv, deps)
}

func meTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"me",
		mcpgo.WithDescription("Return the currently authenticated StandMeet owner."),
	)
}

func invokeMe(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized: invalid or missing api token")
		}
		owner, err := deps.Owners.GetByID(ctx, ownerID)
		if err != nil {
			if errors.Is(err, domain.ErrOwnerNotFound) {
				return mcpgo.NewToolResultError("owner not found")
			}
			deps.Log.Error("mcp me failed", "err", err)
			return mcpgo.NewToolResultError("internal error")
		}
		return mcpgo.NewToolResultText(formatOwner(&owner))
	}
}

func formatOwner(o *domain.Owner) string {
	return `{"owner_id":"` + o.ID + `","email":"` + o.Email +
		`","handle":"` + o.Handle + `","full_name":"` + o.FullName + `"}`
}
