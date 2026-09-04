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
	// Version —— this instance's running version, reported in the MCP handshake so the owner's
	// client (and its agent) sees which build it's driving, and surfaced in the connect
	// instructions with a nudge to run instance.upgrade_check. Passed in from the composition
	// root (port.AppVersion); mcphandle must not reach into that layer itself.
	Version string
}

// ServerInstructions —— the guidance the connecting agent receives automatically in the MCP
// initialize response. An owner installs the client and their agent should then know, without
// being told, how to manage the corpus and to check it's on the latest version. Kept short and
// imperative on purpose (ASD-STE100): it competes for the agent's context on every session.
// Exported so it can be verified black-box.
func ServerInstructions(version string) string {
	return "StandMeet owner tools — curate the personal corpus that a visitor's AI answers from, " +
		"in the owner's voice.\n\n" +
		"Corpus model. One pipeline, three genres: raw → wiki → output.\n" +
		"- raw: rough, unedited thinking. Capture it freely with corpus.create (genre \"raw\").\n" +
		"- wiki: durable, refined ideas. A visitor's AI grounds its answers here — promote to " +
		"wiki only once an idea is stable.\n" +
		"- output: polished public artifacts.\n" +
		"Move an item one step along the pipeline with corpus.promote (the genre names the " +
		"SOURCE). Edit with corpus.update, remove with corpus.delete, read with corpus.list / " +
		"corpus.get, and find with corpus.search.\n\n" +
		"Best practices.\n" +
		"- Write raw first; promote deliberately. Prefer promote over re-creating — it keeps the " +
		"pipeline link.\n" +
		"- Keep each item single-topic; give sibling items distinct slugs.\n" +
		"- writings.* manage long-form published pieces; page.* manage the public page (pins, " +
		"handle, URL).\n" +
		"- custom_page.* build hosted React pages. Before authoring one, call custom_page.guide " +
		"— the design system, the SDK widgets, and how to show corpus inline.\n\n" +
		"Version. This instance runs " + version + ". At the start of a session, call " +
		"instance.upgrade_check to see whether a newer StandMeet was released and whether this " +
		"instance can upgrade itself."
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
	version := deps.Version
	if version == "" {
		version = "dev"
	}
	mcpSrv := server.NewMCPServer(
		"standmeet",
		version,
		server.WithToolCapabilities(true),
		server.WithInstructions(ServerInstructions(version)),
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
