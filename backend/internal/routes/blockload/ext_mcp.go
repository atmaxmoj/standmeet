// ext_mcp.go —— Phase B-3: extMCPFiber.
//
// It lives in blockload rather than in the plugin substrate because producing this fiber **needs
// domain data**: the owner's registered MCP servers belong to conversation. A loader that reads a
// domain cannot sit inside the substrate the domain depends on — that is a domain-level cycle, and
// it is exactly the one this package's doc comment warns about. `check-domain-acyclic` caught it
// (conversation -> plugin -> conversation) the moment the substrate became its own module.
// External MCP servers (URL + auth) the owner registered in admin get dialed
// concurrently during visitor-session assembly; each server.ListTools call is
// exposed as ext_<server>_<tool>, and calls run through session.CallTool. The
// session is released in Binding.Close, with dial/close counts tallied into
// registry.ExtMCP{Dialed,Closed}.
//
// Shape=visitor_only; the owner talks to external servers directly through
// their own MCP client, not through standmeet's forwarding.

package blockload

import (
	"context"
	"strings"
	"sync"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/mcpclient"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin/mount"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

const (
	blockExtMCP   = "ext.mcp"
	extToolPrefix = "ext_"
)

// extMCPFiber —— narrow deps (#131): the owner's registered external MCP server
// directory + a seam-dep connectivity query (when an ext-mcp tool declares
// _meta.requires, it is gated on grant+connected — see _deps.go).
type extMCPFiber struct {
	servers   conversation.MCPServerGetter
	connected DepConnected
}

// NewExtMCPLoader —— the ext-mcp fiber, as a registry.Fiber.
//
// The concrete type stays unexported on purpose: everything a caller does with it goes through
// the Fiber interface (register it, let the registry walk it), and exporting the struct would
// invite someone to reach past that and call a method the registry never would.
func NewExtMCPLoader(
	servers conversation.MCPServerGetter, connected DepConnected,
) registry.Fiber {
	return &extMCPFiber{servers: servers, connected: connected}
}

func (*extMCPFiber) ID() string { return blockExtMCP }
func (*extMCPFiber) Shape() registry.Shape {
	return registry.ShapeVisitorOnly
}

func (*extMCPFiber) OwnerMCPBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{}
}

func (*extMCPFiber) SystemPromptFragment(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

func (*extMCPFiber) SystemPromptFragmentID(
	_ context.Context, _ *registry.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— resolve role.MCPServerIDs → dial concurrently → ListTools →
// Tools[]. Any server whose dial / ListTools fails is silently skipped (logged,
// without blocking the whole chat). The Close hook releases every session and
// updates the counters.
func (c *extMCPFiber) VisitorBinding(
	ctx context.Context, in *registry.AssembleInput,
) (*registry.Binding, error) {
	servers := loadMCPServersForRole(ctx, c.servers, in)
	if len(servers) == 0 {
		return nil, registry.ErrHidden
	}
	bundle := dialExternalMCPs(ctx, servers, c.connected)
	if len(bundle.tools) == 0 {
		bundle.closeAll()
		return nil, registry.ErrHidden
	}
	return &registry.Binding{
		Tools: bundle.tools,
		State: registry.FiberState{ID: blockExtMCP, Enabled: true},
		Close: bundle.closeAll,
	}, nil
}

func loadMCPServersForRole(
	ctx context.Context, servers conversation.MCPServerGetter, in *registry.AssembleInput,
) []marketplace.DialableMCPServer {
	if servers == nil || in.RoleSnapshot == nil {
		return []marketplace.DialableMCPServer{}
	}
	ids := in.RoleSnapshot.MCPServerIDs()
	out := make([]marketplace.DialableMCPServer, 0, len(ids))
	for _, id := range ids {
		cfg, err := servers.GetByID(ctx, in.OwnerID, id)
		if err != nil {
			continue
		}
		out = append(out, cfg)
	}
	return out
}

// extMCPBundle —— the sessions + tools produced by one round of dialing, bundled
// so the Close hook closure can hold a reference and VisitorBinding gets the
// tools list to hand to the LLM.
type extMCPBundle struct {
	tools    []registry.BindingTool
	sessions []*mcpclient.Session
}

func (b *extMCPBundle) closeAll() {
	for _, s := range b.sessions {
		s.Close()
		registry.ExtMCPClosed()
	}
	b.sessions = nil
}

func dialExternalMCPs(
	ctx context.Context, servers []marketplace.DialableMCPServer, connected DepConnected,
) *extMCPBundle {
	bundle := &extMCPBundle{}
	results := dialAllInParallel(ctx, servers)
	for i := range results {
		bundle.absorb(ctx, &servers[i], connected, &results[i])
	}
	return bundle
}

type dialResult struct {
	err     error
	session *mcpclient.Session
	tools   []mcpclient.Tool
}

func dialAllInParallel(
	ctx context.Context, servers []marketplace.DialableMCPServer,
) []dialResult {
	out := make([]dialResult, len(servers))
	var wg sync.WaitGroup
	for i := range servers {
		wg.Go(func() {
			out[i] = dialOne(ctx, &servers[i])
		})
	}
	wg.Wait()
	return out
}

func dialOne(ctx context.Context, cfg *marketplace.DialableMCPServer) dialResult {
	// The auth headers are already plaintext here — decryption happens on the side that
	// implements MCPServerGetter (the composition root). This used to have its own
	// buildAuthHeaders calling cryptobox.Decrypt: assembly is an inner layer, and inner
	// layers don't unseal secrets.
	sess, derr := mcpclient.Dial(ctx, cfg.URL, cfg.AuthHeader.Headers())
	if derr != nil {
		return dialResult{err: derr}
	}
	tools, terr := sess.ListTools(ctx)
	if terr != nil {
		sess.Close()
		return dialResult{err: terr}
	}
	registry.ExtMCPDialed()
	return dialResult{session: sess, tools: tools}
}

func (b *extMCPBundle) absorb(
	ctx context.Context, cfg *marketplace.DialableMCPServer, connected DepConnected, r *dialResult,
) {
	if r.err != nil || r.session == nil {
		return
	}
	b.sessions = append(b.sessions, r.session)
	for i := range r.tools {
		b.addTool(ctx, cfg, connected, r.session, &r.tools[i])
	}
}

// addTool —— expose one ext-mcp tool, gated first by seam-dep (ext-mcp is lowest
// trust, see _deps.go): the tool's declared requires must be explicitly granted by the
// owner AND already connected, otherwise it's hidden.
func (b *extMCPBundle) addTool(
	ctx context.Context, cfg *marketplace.DialableMCPServer, connected DepConnected,
	session *mcpclient.Session, t *mcpclient.Tool,
) {
	if !extToolDepsAllowed(ctx, cfg, connected, t) {
		return
	}
	toolName := composeExtToolName(cfg.Name, t.Name)
	if toolName == "" {
		return
	}
	bt := registry.NewTool(
		toolName,
		extToolDescription(cfg.Name, t),
		"calling external mcp",
		t.InputSchema,
		mount.MakeMCPRun(session, t.Name, nil, 0), // third-party ext tools: default budget
	)
	bt.ReadOnly = t.ReadOnly // a tool whose server declares readOnlyHint may go via QUERY
	b.tools = append(b.tools, bt)
}

func composeExtToolName(server, tool string) string {
	return mount.SanitizeToolName(extToolPrefix + server + "_" + tool)
}

func extToolDescription(server string, t *mcpclient.Tool) string {
	prefix := "[" + server + "] "
	if t.Description == "" {
		return prefix + t.Name
	}
	return prefix + strings.TrimSpace(t.Description)
}

// The call helper (MakeMCPRun / CallToToolResult) lives in the mount package: it is about the
// MCP transport, and the mounted block dials one the same way this loader does.
