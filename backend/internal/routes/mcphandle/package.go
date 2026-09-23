// package.go — GET /api/mcp-package: streams the pinned mcp-client tarball baked into this image.
//
// The owner MCP client (sdk/packages/mcp-client) is a separate artifact that does NOT ride the
// instance's own upgrade. Its `update_self` tool pulls the matching client from here and reinstalls
// it — so this endpoint is gated by the SAME owner-keypair Sigv1 auth as /mcp (an anonymous request
// must not walk off with a binary). See docs/design/mcp-self-update.md.

package mcphandle

import "net/http"

// mcpPackagePath — where the Dockerfile production stage bakes the client tarball. Fixed, no knob:
// every image that serves this endpoint bakes the tarball here, and an image without it simply 404s
// (see servePackage). Tests exercise the same baked default rather than pointing it elsewhere.
const mcpPackagePath = "/srv/mcp-client.tgz"

// NewPackageHandler — the /api/mcp-package handler, behind the same Sigv1 middleware as /mcp.
func NewPackageHandler(deps *Deps) http.Handler {
	return authMiddleware(deps, http.HandlerFunc(servePackage))
}

// servePackage — stream the baked client tarball. http.ServeFile handles open / stat / Range and a
// 404 when the file is absent (an image built without the client baked in), so this face stays a
// declaration plus a call, with no branching to push down into a domain.
func servePackage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("Content-Disposition", `attachment; filename="standmeet-mcp-client.tgz"`)
	http.ServeFile(w, r, mcpPackagePath)
}
