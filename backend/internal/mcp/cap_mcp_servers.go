// cap_mcp_servers.go —— Phase E-7: owner external MCP server registry CRUD
// via Capability。3 tools: mcp_server_create / list / delete。owner-only。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

const capMCPServersBundle = "mcp_servers.bundle"

type mcpServersCapability struct {
	servers *usecases.MCPServersDeps
	log     *slog.Logger
}

func newMCPServersCapability(
	servers *usecases.MCPServersDeps, log *slog.Logger,
) *mcpServersCapability {
	return &mcpServersCapability{servers: servers, log: log}
}

func (*mcpServersCapability) ID() string               { return capMCPServersBundle }
func (*mcpServersCapability) Shape() agentskills.Shape { return agentskills.ShapeOwnerOnly }
func (*mcpServersCapability) VisitorBinding(
	_ context.Context, _ *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	return nil, agentskills.ErrHidden
}

func (*mcpServersCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (*mcpServersCapability) SystemPromptFragmentID(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *mcpServersCapability) OwnerMCPBindings() []*agentskills.MCPBinding {
	return []*agentskills.MCPBinding{
		c.createBinding(), c.listBinding(), c.deleteBinding(),
	}
}

// ───── mcp_server_create ────────────────────────────────────────

func (c *mcpServersCapability) createBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	args, perr := parseMCPServerCreateArgs(raw)
	if perr != nil {
		return agentskills.MCPError(perr.Error())
	}
	cfg, err := usecases.CreateMCPServer(ctx, *c.servers, &usecases.CreateMCPServerInput{
		OwnerID: ownerID, Name: args.Name, URL: args.URL,
		AuthHeaderName: args.AuthHeaderName, AuthHeaderValue: args.AuthHeaderValue,
	})
	if err != nil {
		return mcpServerCreateErrToResult(c.log, err)
	}
	return marshalCapResult(c.log, "mcp_server_create", map[string]string{
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

func mcpServerCreateErrToResult(log *slog.Logger, err error) agentskills.MCPResult {
	if errors.Is(err, domain.ErrMCPServerNameTaken) {
		return agentskills.MCPError("mcp server name already taken")
	}
	log.Error("cap mcp_server_create", "err", err)
	return agentskills.MCPError("create mcp server failed")
}

// ───── mcp_server_list ──────────────────────────────────────────

func (c *mcpServersCapability) listBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	rows, err := usecases.ListMCPServers(ctx, *c.servers, ownerID)
	if err != nil {
		c.log.Error("cap mcp_server_list", "err", err)
		return agentskills.MCPError("list mcp servers failed")
	}
	out := make([]mcpServerListRow, 0, len(rows))
	for i := range rows {
		out = append(out, mcpServerListRow{
			ID: rows[i].ID, Name: rows[i].Name, URL: rows[i].URL,
			AuthHeaderName: rows[i].AuthHeaderName,
			CreatedAt:      rows[i].CreatedAt.Format(mcpTimeFmt),
		})
	}
	return marshalCapResult(c.log, "mcp_server_list", out)
}

// ───── mcp_server_delete ───────────────────────────────────────

func (c *mcpServersCapability) deleteBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
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
) agentskills.MCPResult {
	var args mcpServerDeleteArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return agentskills.MCPError("invalid arguments: " + err.Error())
	}
	if args.ServerID == "" {
		return agentskills.MCPError("server_id is required")
	}
	if err := usecases.DeleteMCPServer(ctx, *c.servers, ownerID, args.ServerID); err != nil {
		if errors.Is(err, domain.ErrMCPServerNotFound) {
			return agentskills.MCPError("mcp server not found")
		}
		c.log.Error("cap mcp_server_delete", "err", err)
		return agentskills.MCPError("delete mcp server failed")
	}
	return marshalCapResult(c.log, "mcp_server_delete", map[string]string{
		"server_id": args.ServerID,
	})
}
