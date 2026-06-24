// Package mcphandle 提供 owner 的 AI 客户端用的 MCP server（owner 自管理工具的
// controller 层，住 internal/routes/ 下与 admin/public/sys 并列）。
//
// Auth：Bearer API token（mcp:write/mcp:read/mcp:pages 在 v1 不分粒度，所有
// token 一视同仁）。token 校验通过 HTTPContextFunc 注 ownerID 到 ctx，tool
// handler 从 ctx 取。
//
// Transport：mcp-go 的 streamable HTTP。/mcp/ 同 endpoint 处理 POST request +
// 可选 SSE。
package mcphandle

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/plugins/jobs/jobsuc"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

type ctxKey struct{ name string }

var ctxKeyOwnerID = ctxKey{name: "mcpOwnerID"}

// Deps —— MCP server 需要的业务依赖。
type Deps struct {
	Keypairs      usecases.KeypairDeps
	Jobs          jobsuc.JobsDeps
	Owners        OwnerLookup
	Corpus        usecases.CorpusDeps
	SEO           SEOWriter
	CustomPages   usecases.CustomPageDeps
	Resume        jobsuc.ResumeDeps
	Log           *slog.Logger
	Applications  jobsuc.ApplicationsDeps
	Conversations usecases.ConversationsDeps
	Skills        usecases.SkillsDeps
	Prompts       usecases.PromptsDeps
	Roles         usecases.RolesDeps
	MCPServers    usecases.MCPServersDeps
	Writings      usecases.WritingsDeps
	WritingsTx    usecases.WritingsTxDeps
	// AgentSkills —— owner MCP facade 的唯一工具来源。registerTools 只是
	// walk reg.OwnerMCPBindings()（Phase E 收尾，老 tools_*.go AddTool 全删）：
	// core owner capability + 插件 owner 工具汇成单端点，core 不写死 tool 清单。
	AgentSkills *capreg.Registry
}

// SEOWriter —— seo.* MCP tools 需要的最小接口（避开直接 import postgres.SEORepo）。
// 地址树派生,不再设 path —— 只写 SEO 描述 + indexed 开关。
type SEOWriter interface {
	UpdateWikiSEO(
		ctx context.Context, wikiID, description string, indexed bool,
	) (domain.Wiki, error)
	UpdateOutputSEO(
		ctx context.Context, outputID, description string, indexed bool,
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

// registerTools 把所有 owner tool 注册到 mcpSrv。Phase E 收尾：只剩一行
// registerCapabilities walk —— 所有 tool 都走 capreg.Registry（facade 聚合，
// core 不写死）。
func registerTools(mcpSrv *server.MCPServer, deps *Deps) {
	registerCapabilities(mcpSrv, deps.AgentSkills, deps.Log)
}

// formatOwner —— `me` capability + 其他可能引用 owner profile 的地方共用。
func formatOwner(o *domain.Owner) string {
	return `{"owner_id":"` + o.ID + `","email":"` + o.Email +
		`","handle":"` + o.Handle + `","full_name":"` + o.FullName + `"}`
}
