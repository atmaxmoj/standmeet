// from_dispatcher.go —— the MCP face = the **projection** (generated) of the
// outbound convergence point.
//
// Walk the dispatcher's operations, and each Op grows into an MCP tool. There
// is no "tool manifest" here that could be left out of sync — the face isn't
// hand-written, it's grown. This is exactly what "MCP marked Generated" means
// in the facade-parity design: "there is no hand-written step to forget".
//
// The convergence point knows nothing about MCP: Op.Invoke sends/receives
// json.RawMessage, and errors are thrown as-is. Translating that into MCP's
// CallToolResult / isError is **this face's** job, done in this one place.

package mcphandle

import (
	"context"
	"encoding/json"
	"log/slog"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

// MCPFace —— the MCP face's record in parity: it serves the owner's reads
// and actions, and cannot carry browser flows, plaintext secrets, or
// multipart (it only handles pure JSON tool calls).
func MCPFace() fp.Facade {
	return fp.Facade{Name: "mcp", Plane: fp.PlaneOwner, ServesRead: true, ServesActn: true}
}

// registerDispatcherOps —— mounts every operation in the convergence point
// as an MCP tool. owner_id resolution / panic recover / result translation
// reuse wrapCapabilityHandler, going through the same wrapping as tools
// coming from capreg.
//
// Ops are fetched via Face.Ops(): **all are taken at once, and taking them
// registers them as projected in the same step**. So this face can neither
// miss mounting an op (there is no hand-written manifest to omit one from),
// nor claim to have mounted one without actually doing so (the registration
// IS the taking).
func registerDispatcherOps(srv *server.MCPServer, d *dispatcher.Dispatcher, log *slog.Logger) {
	ops := d.Attach(MCPFace()).Ops()
	for i := range ops {
		tool := mcpgo.NewToolWithRawSchema(ops[i].ID, ops[i].Description, ops[i].InputSchema)
		srv.AddTool(tool, wrapCapabilityHandler(mcpHandlerFor(ops[i].Invoke), ops[i].ID, log))
	}
}

// mcpHandlerFor —— converts the protocol-agnostic Invoke into MCP's handler
// shape. error → an isError result; a success payload passes through as-is
// (the convergence point's output is already JSON).
func mcpHandlerFor(invoke dispatcher.Invoke) capreg.MCPHandler {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) capreg.MCPResult {
		out, err := invoke(ctx, ownerID, raw)
		if err != nil {
			return capreg.MCPError(err.Error())
		}
		return capreg.MCPSuccess(string(out))
	}
}
