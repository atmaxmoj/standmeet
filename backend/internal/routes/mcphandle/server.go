// Package mcphandle provides the MCP server used by the owner's AI client (the
// controller layer for the owner's self-service tools, living under
// internal/routes/ alongside admin/public/sys).
//
// Auth: Bearer API token (mcp:write/mcp:read/mcp:pages are not split by
// granularity in v1 — every token is treated the same). Token verification
// injects ownerID into ctx via HTTPContextFunc; the tool handler reads it
// from ctx.
//
// Transport: mcp-go's streamable HTTP. The single /mcp/ endpoint handles
// both POST requests and optional SSE.
package mcphandle

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type ctxKey struct{ name string }

var ctxKeyOwnerID = ctxKey{name: "mcpOwnerID"}

// Deps —— the business dependencies the MCP server needs. Since #135, owner
// tools are all externalized into ownercore plugins, and registerTools only
// walks AgentSkills (reg.OwnerMCPBindings()), so the core server only needs:
//   - Keypairs: Sigv1 signature verification
//   - AgentSkills: the owner MCP facade's sole tool source (core caps + plugin
//     owner tools converge into a single endpoint)
type Deps struct {
	Keypairs    owner.KeypairDeps
	AgentSkills *capreg.Registry
	// Dispatcher —— the outbound convergence point: every outbound-facing
	// capability (domain ops / connector caps / capreg caps) is declared here,
	// and the MCP face is its projection (generated). See internal/routes/dispatcher.
	Dispatcher *dispatcher.Dispatcher
	Log        *slog.Logger
}

// New builds an http.Handler with the tools already mounted; the caller
// mounts it at the /mcp/* route.
//
// Two wrapping layers: authMiddleware (Sigv1 verification, on failure a 401
// returns immediately) → the mcp-go streamable HTTP server. authContextFunc
// has been replaced by the middleware (which verifies + sets ctx);
// HTTPContextFunc now only carries ownerID from the request ctx to the mcp
// ctx.
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

// authMiddleware does Sigv1 verification ahead of mcp-go: on failure it
// returns 401 immediately without entering mcp-go; on success it puts
// ownerID into the request ctx, and HTTPContextFunc then propagates it to
// the mcp ctx.
//
// Phase C: the legacy Bearer PAT path has been removed; only
// `Authorization: Sigv1 keyId=X, ts=N,sig=base64` is recognized.
func authMiddleware(deps *Deps, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader := r.Header.Get("Authorization")
		ownerID, err := owner.VerifySigv1(r.Context(), deps.Keypairs, authHeader)
		if err != nil {
			http.Error(w, "unauthorized: invalid Sigv1", http.StatusUnauthorized)
			return
		}
		ctx := context.WithValue(r.Context(), ctxKeyOwnerID, ownerID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// propagateOwnerCtx —— HTTPContextFunc: takes ownerID from the request ctx
// (already verified and put there by the middleware) and moves it to the
// mcp ctx (the tool handler reads it via OwnerIDFrom).
func propagateOwnerCtx(ctx context.Context, r *http.Request) context.Context {
	v, ok := r.Context().Value(ctxKeyOwnerID).(string)
	if !ok {
		return ctx
	}
	return context.WithValue(ctx, ctxKeyOwnerID, v)
}

// OwnerIDFrom reads owner_id from ctx; used by tool handlers. An empty
// string means unauthenticated.
func OwnerIDFrom(ctx context.Context) string {
	v, ok := ctx.Value(ctxKeyOwnerID).(string)
	if !ok {
		return ""
	}
	return v
}

// registerTools registers every owner tool into mcpSrv. Two sources:
//   - capreg.Registry —— capabilities that are real on the capability axis
//     (owner tools declared by plugins, etc.);
//   - dispatcher —— the outbound convergence point; the MCP face is its
//     projection (generated, see from_dispatcher.go).
//
// During the migration both coexist: every resource moved into the
// convergence point means ownercore registers one fewer, until ownercore
// is deleted entirely.
func registerTools(mcpSrv *server.MCPServer, deps *Deps) {
	registerCapabilities(mcpSrv, deps.AgentSkills, deps.Log)
	registerDispatcherOps(mcpSrv, deps.Dispatcher, deps.Log)
}
