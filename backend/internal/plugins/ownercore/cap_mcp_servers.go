// cap_mcp_servers.go —— Phase E-7: owner external MCP server registry CRUD
// via Capability。3 tools: mcp_server_create / list / delete。owner-only。

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

const capMCPServersBundle = "mcp_servers.bundle"

type mcpServersCapability struct {
	servers *marketplace.MCPServersDeps
	log     *slog.Logger
}

func newMCPServersCapability(
	servers *marketplace.MCPServersDeps, log *slog.Logger,
) *mcpServersCapability {
	return &mcpServersCapability{servers: servers, log: log}
}

func (*mcpServersCapability) ID() string          { return capMCPServersBundle }
func (*mcpServersCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*mcpServersCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*mcpServersCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*mcpServersCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *mcpServersCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{
		c.createBinding(), c.listBinding(), c.deleteBinding(),
		c.grantDepBinding(),
	}
}

// ───── mcp_server_create ────────────────────────────────────────

func (c *mcpServersCapability) createBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "mcp_server_create",
		Description: "Register an external MCP server (HTTP streamable). " +
			"Attach it to invite codes; visitors with that code get those tools.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"name":{"type":"string","description":"Server name, unique per owner."},
				"url":{"type":"string","description":"HTTP MCP endpoint URL (streamable HTTP)."},
				"auth_header_name":{"type":"string",
					"description":"Optional auth header name (e.g. 'Authorization')."},
				"auth_header_value":{"type":"string",
					"description":"Optional auth header value. Stored encrypted."}
			},
			"required":["name","url"]
		}`),
		Handler: c.handleCreate,
	}
}

type mcpServerCreateArgsWire struct {
	Name            string `json:"name"`
	URL             string `json:"url"`
	AuthHeaderName  string `json:"auth_header_name"`
	AuthHeaderValue string `json:"auth_header_value"`
}

func (c *mcpServersCapability) handleCreate(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseMCPServerCreateArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	cfg, err := marketplace.CreateMCPServer(ctx, *c.servers, &marketplace.CreateMCPServerReq{
		OwnerID: ownerID, Name: args.Name, URL: args.URL,
		AuthHeaderName: args.AuthHeaderName, AuthHeaderValue: args.AuthHeaderValue,
	})
	if err != nil {
		return mcpServerCreateErrToResult(c.log, err)
	}
	return mcputil.MarshalResult(c.log, "mcp_server_create", map[string]string{
		"server_id": cfg.ID, "name": cfg.Name, "url": cfg.URL,
	})
}

func parseMCPServerCreateArgs(raw json.RawMessage) (mcpServerCreateArgsWire, error) {
	var args mcpServerCreateArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.Name == "" {
		return args, errors.New("name is required")
	}
	if args.URL == "" {
		return args, errors.New("url is required")
	}
	return args, nil
}

func mcpServerCreateErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, marketplace.ErrMCPServerNameTaken) {
		return capreg.MCPError("mcp server name already taken")
	}
	log.Error("cap mcp_server_create", "err", err)
	return capreg.MCPError("create mcp server failed")
}

// ───── mcp_server_list ──────────────────────────────────────────

func (c *mcpServersCapability) listBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "mcp_server_list",
		Description: "List all owner-registered external MCP servers.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleList,
	}
}

type mcpServerListRow struct {
	CreatedAt      string `json:"created_at"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	AuthHeaderName string `json:"auth_header_name,omitempty"`
}

func (c *mcpServersCapability) handleList(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	rows, err := marketplace.ListMCPServers(ctx, *c.servers, ownerID)
	if err != nil {
		c.log.Error("cap mcp_server_list", "err", err)
		return capreg.MCPError("list mcp servers failed")
	}
	out := make([]mcpServerListRow, 0, len(rows))
	for i := range rows {
		out = append(out, mcpServerListRow{
			ID: rows[i].ID, Name: rows[i].Name, URL: rows[i].URL,
			AuthHeaderName: rows[i].AuthHeaderName,
			CreatedAt:      rows[i].CreatedAt.Format(mcpTimeFmt),
		})
	}
	return mcputil.MarshalResult(c.log, "mcp_server_list", out)
}

// ───── mcp_server_delete ───────────────────────────────────────

func (c *mcpServersCapability) deleteBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "mcp_server_delete",
		Description: "Delete an owner-registered external MCP server. " +
			"Existing invite codes lose access; code_mcp_servers join rows cascade.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"server_id":{"type":"string","description":"Server id"}
			},
			"required":["server_id"]
		}`),
		Handler: c.handleDelete,
	}
}

type mcpServerDeleteArgsWire struct {
	ServerID string `json:"server_id"`
}

func (c *mcpServersCapability) handleDelete(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args mcpServerDeleteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.ServerID == "" {
		return capreg.MCPError("server_id is required")
	}
	if err := marketplace.DeleteMCPServer(ctx, *c.servers, ownerID, args.ServerID); err != nil {
		if errors.Is(err, marketplace.ErrMCPServerNotFound) {
			return capreg.MCPError("mcp server not found")
		}
		c.log.Error("cap mcp_server_delete", "err", err)
		return capreg.MCPError("delete mcp server failed")
	}
	return mcputil.MarshalResult(c.log, "mcp_server_delete", map[string]string{
		"server_id": args.ServerID,
	})
}

// ───── mcp_server_grant_dep ─────────────────────────────────────

func (c *mcpServersCapability) grantDepBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "mcp_server_grant_dep",
		Description: "Grant this ext-MCP server a connector dependency. ext-MCP is " +
			"lowest-trust: tools declaring Requires stay uninjected until the owner " +
			"grants the dep here. Idempotent. server_id must belong to the owner.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"server_id":{"type":"string","description":"Server id"},
				"dep":{"type":"string","description":"Connector dependency name to grant."}
			},
			"required":["server_id","dep"]
		}`),
		Handler: c.handleGrantDep,
	}
}

type mcpServerGrantDepArgsWire struct {
	ServerID string `json:"server_id"`
	Dep      string `json:"dep"`
}

func parseGrantDepArgs(raw json.RawMessage) (mcpServerGrantDepArgsWire, error) {
	var args mcpServerGrantDepArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return args, errors.New("invalid arguments: " + err.Error())
	}
	if args.ServerID == "" {
		return args, errors.New("server_id is required")
	}
	if args.Dep == "" {
		return args, errors.New("dep is required")
	}
	return args, nil
}

func (c *mcpServersCapability) handleGrantDep(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	args, perr := parseGrantDepArgs(raw)
	if perr != nil {
		return capreg.MCPError(perr.Error())
	}
	err := marketplace.GrantMCPServerDep(ctx, *c.servers, ownerID, args.ServerID, args.Dep)
	if err != nil {
		if errors.Is(err, marketplace.ErrMCPServerNotFound) {
			return capreg.MCPError("mcp server not found")
		}
		c.log.Error("cap mcp_server_grant_dep", "err", err)
		return capreg.MCPError("grant mcp server dep failed")
	}
	return mcputil.MarshalResult(c.log, "mcp_server_grant_dep", map[string]any{
		"server_id": args.ServerID, "dep": args.Dep, "granted": true,
	})
}
