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
	"log/slog"
	"net/http"

	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

type ctxKey struct{ name string }

var ctxKeyOwnerID = ctxKey{name: "mcpOwnerID"}

// Deps —— MCP server 需要的业务依赖。
type Deps struct {
	Keypairs      usecases.KeypairDeps
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
	Prompts       usecases.PromptsDeps
	Roles         usecases.RolesDeps
	MCPServers    usecases.MCPServersDeps
	Writings      usecases.WritingsDeps
	WritingsTx    usecases.WritingsTxDeps
	// AgentSkills —— Phase B-4 起 owner MCP tool 也走 Capability registry。
	// 老的 tools_*.go AddTool 调用与 registerCapabilities walk 共存；逐步
	// 把老文件迁成 Capability + 删 AddTool 调用。
	AgentSkills *agentskills.Registry
}

// SEOWriter —— seo.* MCP tools 需要的最小接口（避开直接 import postgres.SEORepo）。
type SEOWriter interface {
	UpdateWikiPath(
		ctx context.Context, wikiID string,
		path *string, description string, indexed bool,
	) (domain.Wiki, error)
	UpdateOutputPath(
		ctx context.Context, outputID string,
		path *string, description string, indexed bool,
	) (domain.Output, error)
	GetSettings(ctx context.Context, ownerID string) (domain.SEOSettings, error)
	UpsertSettings(ctx context.Context, in *domain.SEOSettings) (domain.SEOSettings, error)
}

// OwnerLookup 是 MCP 工具调用时按 ownerID 取 owner profile 的最小接口
// （避免直接 import postgres.OwnerRepo 让 lint 报 component 越权）。
type OwnerLookup interface {
	GetByID(ctx context.Context, ownerID string) (domain.Owner, error)
}

// New 构造一个挂好工具的 http.Handler，调用方挂到 /mcp/* 路由。
//
// 包两层：authMiddleware (Sigv1 验签，失败 401 立即 return) → mcp-go
// streamable HTTP server。authContextFunc 已被 middleware 取代 (verifies
// + sets ctx)，HTTPContextFunc 只把 ownerID 从 request ctx 转到 mcp ctx。
func New(deps *Deps) http.Handler {
	mcpSrv := server.NewMCPServer(
		"standmeet",
		"0.1.0",
		server.WithToolCapabilities(true),
	)
	registerTools(mcpSrv, deps)

	httpSrv := server.NewStreamableHTTPServer(
		mcpSrv,
		server.WithHTTPContextFunc(propagateOwnerCtx),
		server.WithEndpointPath("/mcp"),
	)
	return authMiddleware(deps, httpSrv)
}

// authMiddleware 在 mcp-go 上层做 Sigv1 验签：失败 401 立即返不进 mcp-go；
// 通过则把 ownerID 塞 request ctx，HTTPContextFunc 再 propagate 到 mcp ctx。
//
// Phase C：legacy Bearer PAT 路径已删；只认 `Authorization: Sigv1 keyId=X,
// ts=N,sig=base64`。
func authMiddleware(deps *Deps, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		ownerID, err := usecases.VerifySigv1(r.Context(), deps.Keypairs, authHeader)
		if err != nil {
			http.Error(w, "unauthorized: invalid Sigv1", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), ctxKeyOwnerID, ownerID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// propagateOwnerCtx —— HTTPContextFunc：从 request ctx 取 ownerID (middleware
// 已校验通过塞进去) 转移到 mcp ctx (tool handler 用 OwnerIDFrom 读)。
func propagateOwnerCtx(ctx context.Context, r *http.Request) context.Context {
	v, ok := r.Context().Value(ctxKeyOwnerID).(string)
	if !ok {
		return ctx
	}
	return context.WithValue(ctx, ctxKeyOwnerID, v)
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
// Phase B-4: 新的 capability 经 agentskills.Registry 注册；老的 tools_*.go
// 暂时保留直接 AddTool 调用，逐步迁移为 Capability OwnerMCPBinding。
func registerTools(mcpSrv *server.MCPServer, deps *Deps) {
	registerCapabilities(mcpSrv, deps.AgentSkills, deps.Log)
	// corpusTools 已 E-1 迁到 cap_corpus_raw.go
	// outputTools 已 E-2 迁到 cap_corpus_output.go
	// seoTools 已搬进 cap_seo.go (走 registerCapabilities)
	customPageTools(mcpSrv, deps)
	jobsTools(mcpSrv, deps)
	resumeTools(mcpSrv, deps)
	applicationsTools(mcpSrv, deps)
	// chatTools 已 E-4 迁到 cap_chat.go
	skillsTools(mcpSrv, deps)
	// promptsTools 已 E-5 迁到 cap_prompts.go
	rolesTools(mcpSrv, deps)
	mcpServersTools(mcpSrv, deps)
	writingsTools(mcpSrv, deps)
}

// formatOwner —— `me` capability + 其他可能引用 owner profile 的地方共用。
func formatOwner(o *domain.Owner) string {
	return `{"owner_id":"` + o.ID + `","email":"` + o.Email +
		`","handle":"` + o.Handle + `","full_name":"` + o.FullName + `"}`
}
