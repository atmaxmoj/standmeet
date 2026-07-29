// capreg_mcp_app_owner.go —— an externalized (sandboxed) capability may also serve **owner-side**
// tools.
//
// Why this exists: a fully-externalized capability owns its logic end-to-end. Before this, a
// sandboxed plugin could only face visitors, so any owner-facing surface of the SAME capability had
// to be re-implemented in the host — which is how the booking policy/slot algorithms ended up
// existing twice (once in mcp-servers/booker, once in the kernel), the two copies free to drift.
// With owner tools declared on the manifest, the capability keeps one implementation and the host
// keeps none.
//
// Declaration is DATA (manifest.OwnerTools): the owner MCP tool table is enumerated at assembly
// time (facade-parity reconciles against it), so it must not require dialing a sandbox at boot.
// The sandbox is dialed only when a tool is actually invoked — declaration → implementation →
// instance, the same meta-structure as the visitor side.

package capload

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// OwnerMCPBindings —— one binding per declared owner tool. Empty for a visitor-only plugin, which
// is every plugin that has not declared OwnerTools.
func (c *mcpAppCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	out := make([]*capreg.MCPBinding, 0, len(c.m.OwnerTools))
	for i := range c.m.OwnerTools {
		t := c.m.OwnerTools[i]
		out = append(out, &capreg.MCPBinding{
			Name:        t.Name,
			Description: t.Description,
			InputSchema: json.RawMessage(t.InputSchema),
			Handler:     c.ownerToolHandler(&t),
		})
	}
	return out
}

// ownerToolHandler —— dial the plugin, forward the call, return its text payload.
//
// An owner call has no visitor session: no conversation, no code, no role — so no workspace is
// provisioned and the only trusted context planted on `_meta` is the owner id. The plugin reaches
// back through its host socket exactly as it does for a visitor call.
//
// Failures are surfaced, never swallowed: a sandbox that will not spawn returns an error to the
// owner's AI client rather than an empty success (the visitor path can hide a broken capability to
// keep chat alive; an owner tool has no such excuse — silence there reads as "no bookings").
func (c *mcpAppCapability) ownerToolHandler(t *mcpplugin.OwnerTool) capreg.MCPHandler {
	tool, name := t.Tool, t.Name
	return func(ctx context.Context, ownerID string, raw json.RawMessage) capreg.MCPResult {
		sess, err := dialMCPApp(ctx, &c.m.Transport, "")
		if err != nil {
			return c.ownerToolErr(err, name+" is unavailable right now")
		}
		defer sess.Close()
		out, cerr := sess.CallToolChecked(
			ctx, tool, raw, &mcpclient.SessionContext{OwnerID: ownerID}, 0)
		if cerr != nil {
			return c.ownerToolErr(cerr, name+" failed")
		}
		// The plugin's own error result must arrive at the owner's client AS an error. Wrapping it
		// in a success would hand the AI a payload that merely reads like a failure — the caller
		// could not branch on it, and a bad-args rejection would look like data.
		if out.IsError {
			return capreg.MCPError(out.Text)
		}
		return capreg.MCPSuccess(out.Text)
	}
}

// ownerToolErr —— log the real cause, hand the owner's client a readable message. The cause is
// never dropped: a sandbox that will not spawn showed up once as an unexplained empty tool list.
func (c *mcpAppCapability) ownerToolErr(cause error, msg string) capreg.MCPResult {
	if c.dialErrLog != nil {
		c.dialErrLog(c.m.ID, cause)
	}
	return capreg.MCPError(msg)
}
