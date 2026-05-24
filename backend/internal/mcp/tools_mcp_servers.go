// tools_mcp_servers.go —— owner 在 Claude Desktop 注册外部 MCP server 的
// MCP tools (mcp_server_create / mcp_server_list / mcp_server_delete)。
// 数据落 mcp_servers 表；后续绑到 InviteCode 让 visitor chat 用 (visitor
// 看到 server 的 tool 时前缀 ext_<server>_<tool>)。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/wangsijie/standmeet/internal/domain"
	"github.com/wangsijie/standmeet/internal/usecases"
)

func mcpServersTools(srv *server.MCPServer, deps *Deps) {
	srv.AddTool(mcpServerCreateTool(), wrapTool(invokeMCPServerCreate(deps)))
	srv.AddTool(mcpServerListTool(), wrapTool(invokeMCPServerList(deps)))
	srv.AddTool(mcpServerDeleteTool(), wrapTool(invokeMCPServerDelete(deps)))
}

func mcpServerCreateTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"mcp_server_create",
		mcpgo.WithDescription("Register an external MCP server (HTTP streamable). "+
			"Attach it to invite codes; visitors with that code get those tools."),
		mcpgo.WithString("name", mcpgo.Required(),
			mcpgo.Description("Server name, unique per owner (e.g. 'host-calendar').")),
		mcpgo.WithString("url", mcpgo.Required(),
			mcpgo.Description("HTTP MCP endpoint URL (streamable HTTP).")),
		mcpgo.WithString("auth_header_name",
			mcpgo.Description("Optional auth header name (e.g. 'Authorization').")),
		mcpgo.WithString("auth_header_value",
			mcpgo.Description("Optional auth header value (e.g. 'Bearer abc'). "+
				"Stored encrypted (AES-256-GCM via cryptobox).")),
	)
}

func invokeMCPServerCreate(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		in, perr := parseMCPServerCreateParams(req, ownerID)
		if perr != nil {
			return mcpgo.NewToolResultError(perr.Error())
		}
		return runMCPServerCreate(ctx, deps, in)
	}
}

func parseMCPServerCreateParams(
	req *mcpgo.CallToolRequest, ownerID string,
) (*usecases.CreateMCPServerInput, error) {
	name, err := req.RequireString("name")
	if err != nil {
		return nil, errors.New("name is required")
	}
	url, err := req.RequireString("url")
	if err != nil {
		return nil, errors.New("url is required")
	}
	return &usecases.CreateMCPServerInput{
		OwnerID: ownerID, Name: name, URL: url,
		AuthHeaderName:  req.GetString("auth_header_name", ""),
		AuthHeaderValue: req.GetString("auth_header_value", ""),
	}, nil
}

func runMCPServerCreate(
	ctx context.Context, deps *Deps, in *usecases.CreateMCPServerInput,
) *mcpgo.CallToolResult {
	cfg, err := usecases.CreateMCPServer(ctx, deps.MCPServers, in)
	if err != nil {
		if errors.Is(err, domain.ErrMCPServerNameTaken) {
			return mcpgo.NewToolResultError("mcp server name already taken")
		}
		deps.Log.Error("mcp mcp_server_create", "err", err)
		return mcpgo.NewToolResultError("create mcp server failed")
	}
	return marshalResult(deps, mcpServerIDPayload{
		ServerID: cfg.ID, Name: cfg.Name, URL: cfg.URL,
	})
}

func mcpServerListTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"mcp_server_list",
		mcpgo.WithDescription("List all owner-registered external MCP servers."),
	)
}

func invokeMCPServerList(deps *Deps) invokeFn {
	return func(ctx context.Context, _ *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		rows, err := usecases.ListMCPServers(ctx, deps.MCPServers, ownerID)
		if err != nil {
			deps.Log.Error("mcp mcp_server_list", "err", err)
			return mcpgo.NewToolResultError("list mcp servers failed")
		}
		return marshalResult(deps, mcpServerListView(rows))
	}
}

func mcpServerDeleteTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"mcp_server_delete",
		mcpgo.WithDescription("Delete an owner-registered external MCP server. "+
			"Existing invite codes lose access; code_mcp_servers join rows cascade."),
		mcpgo.WithString("server_id", mcpgo.Required(),
			mcpgo.Description("Server id from mcp_server_create / mcp_server_list.")),
	)
}

func invokeMCPServerDelete(deps *Deps) invokeFn {
	return func(ctx context.Context, req *mcpgo.CallToolRequest) *mcpgo.CallToolResult {
		ownerID := OwnerIDFrom(ctx)
		if ownerID == "" {
			return mcpgo.NewToolResultError("unauthorized")
		}
		serverID, err := req.RequireString("server_id")
		if err != nil {
			return mcpgo.NewToolResultError("server_id is required")
		}
		return runMCPServerDelete(ctx, deps, ownerID, serverID)
	}
}

func runMCPServerDelete(
	ctx context.Context, deps *Deps, ownerID, serverID string,
) *mcpgo.CallToolResult {
	derr := usecases.DeleteMCPServer(ctx, deps.MCPServers, ownerID, serverID)
	if derr == nil {
		return marshalResult(deps, mcpServerIDPayload{ServerID: serverID})
	}
	if errors.Is(derr, domain.ErrMCPServerNotFound) {
		return mcpgo.NewToolResultError("mcp server not found")
	}
	deps.Log.Error("mcp mcp_server_delete", "err", derr)
	return mcpgo.NewToolResultError("delete mcp server failed")
}

// ---- payload ----------------------------------------------------------

type mcpServerIDPayload struct {
	ServerID string `json:"server_id"`
	Name     string `json:"name,omitempty"`
	URL      string `json:"url,omitempty"`
}

func (p mcpServerIDPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal mcp server id payload: %w", err)
	}
	return b, nil
}

type mcpServerView struct {
	CreatedAt      string `json:"created_at"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	AuthHeaderName string `json:"auth_header_name,omitempty"`
}

func mcpServerListView(rows []domain.MCPServerConfig) mcpServerListPayload {
	out := make(mcpServerListPayload, 0, len(rows))
	for i := range rows {
		out = append(out, mcpServerView{
			ID: rows[i].ID, Name: rows[i].Name, URL: rows[i].URL,
			AuthHeaderName: rows[i].AuthHeaderName,
			CreatedAt:      rows[i].CreatedAt.Format(mcpTimeFmt),
		})
	}
	return out
}

type mcpServerListPayload []mcpServerView

func (p mcpServerListPayload) marshalJSON() ([]byte, error) {
	b, err := json.Marshal(p)
	if err != nil {
		return nil, fmt.Errorf("marshal mcp server list payload: %w", err)
	}
	return b, nil
}
