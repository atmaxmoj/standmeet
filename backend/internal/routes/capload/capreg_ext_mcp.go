// capreg_ext_mcp.go —— Phase B-3: extMCPCapability.
// External MCP servers (URL + auth) the owner registered in admin get dialed
// concurrently during visitor-session assembly; each server.ListTools call is
// exposed as ext_<server>_<tool>, and calls run through session.CallTool. The
// session is released in Binding.Close, with dial/close counts tallied into
// capreg.ExtMCP{Dialed,Closed}.
//
// Shape=visitor_only; the owner talks to external servers directly through
// their own MCP client, not through standmeet's forwarding.

package capload

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

const (
	capExtMCP     = "ext.mcp"
	extToolPrefix = "ext_"
)

// extMCPCapability —— narrow deps (#131): the owner's registered external MCP server
// directory + a connector-dep connectivity query (when an ext-mcp tool declares
// _meta.requires, it is gated on grant+connected — see _deps.go).
type extMCPCapability struct {
	servers   conversation.MCPServerGetter
	connected DepConnected
}

func newExtMCPCapability(
	servers conversation.MCPServerGetter, connected DepConnected,
) *extMCPCapability {
	return &extMCPCapability{servers: servers, connected: connected}
}

func (*extMCPCapability) ID() string { return capExtMCP }
func (*extMCPCapability) Shape() capreg.Shape {
	return capreg.ShapeVisitorOnly
}

func (*extMCPCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{}
}

func (*extMCPCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*extMCPCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

// VisitorBinding —— resolve role.MCPServerIDs → dial concurrently → ListTools →
// Tools[]. Any server whose dial / ListTools fails is silently skipped (logged,
// without blocking the whole chat). The Close hook releases every session and
// updates the counters.
func (c *extMCPCapability) VisitorBinding(
	ctx context.Context, in *capreg.AssembleInput,
) (*capreg.Binding, error) {
	servers := loadMCPServersForRole(ctx, c.servers, in)
	if len(servers) == 0 {
		return nil, capreg.ErrHidden
	}
	bundle := dialExternalMCPs(ctx, servers, c.connected)
	if len(bundle.tools) == 0 {
		bundle.closeAll()
		return nil, capreg.ErrHidden
	}
	return &capreg.Binding{
		Tools: bundle.tools,
		State: capreg.CapabilityState{ID: capExtMCP, Enabled: true},
		Close: bundle.closeAll,
	}, nil
}

func loadMCPServersForRole(
	ctx context.Context, servers conversation.MCPServerGetter, in *capreg.AssembleInput,
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
	tools    []capreg.BindingTool
	sessions []*mcpclient.Session
}

func (b *extMCPBundle) closeAll() {
	for _, s := range b.sessions {
		s.Close()
		capreg.ExtMCPClosed()
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
	capreg.ExtMCPDialed()
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

// addTool —— expose one ext-mcp tool, gated first by connector-dep (ext-mcp is lowest
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
	bt := capreg.NewTool(
		toolName,
		extToolDescription(cfg.Name, t),
		"calling external mcp",
		t.InputSchema,
		makeExtMCPRun(session, t.Name, nil, 0), // third-party ext tools: default budget
	)
	bt.ReadOnly = t.ReadOnly // a tool whose server declares readOnlyHint may go via QUERY
	b.tools = append(b.tools, bt)
}

func composeExtToolName(server, tool string) string {
	return sanitizeToolName(extToolPrefix + server + "_" + tool)
}

func extToolDescription(server string, t *mcpclient.Tool) string {
	prefix := "[" + server + "] "
	if t.Description == "" {
		return prefix + t.Name
	}
	return prefix + strings.TrimSpace(t.Description)
}

// makeExtMCPRun —— don't let a CallTool failure abort the whole agent loop — wrap the
// err as errJSON inside tool_result, so the AI sees "external tool failed" and routes
// around it itself. budget is this tool's call budget (<=0 uses the default 15s;
// LLM-backed summarize passes LongCallTimeout, see F-A-6).
func makeExtMCPRun(
	session *mcpclient.Session, realToolName string, sctx *mcpclient.SessionContext,
	budget time.Duration,
) capreg.RunFn {
	return func(ctx context.Context, args string) (string, error) {
		return extCallToToolResult(
			session.CallToolWithin(ctx, realToolName, []byte(args), sctx, budget),
		)
	}
}

// extCallToToolResult —— fold a CallTool err into an errJSON tool_result, so the SDK
// continues rather than aborting (returning nil for the Go-side err is the RunFn
// contract).
//
// The nil is deliberate — it lets the agent loop continue instead of aborting the
// whole stream.
//
//nolint:nilerr // tool-result envelope: err goes into the JSON text, Go err return
func extCallToToolResult(out string, err error) (string, error) {
	if err != nil {
		return errJSON("external mcp tool: " + err.Error()), nil
	}
	return out, nil
}
