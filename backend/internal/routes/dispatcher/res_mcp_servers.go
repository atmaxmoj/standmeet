// res_mcp_servers.go —— 资源 mcp_servers:owner 注册的外部 MCP server(HTTP streamable)。
// 挂到 role 上,带那个码进来的访客就拿到那台 server 的工具。
//
// ext-MCP 是**信任最低**的一档:它的工具如果声明了 connector 依赖,默认不注入,
// 要 owner 在这儿显式 grant 一次。所以 grant 是个独立的 op,不是 create 的一个字段。
//
// auth_header_value 只进不出:它是密钥,加密存,任何一个面的出站载荷里都没有它。

package dispatcher

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// MCPServerStore —— mcp_servers 这组操作所需的最小口。
type MCPServerStore interface {
	List(ctx context.Context, ownerID string) ([]MCPServer, error)
	Create(ctx context.Context, in *CreateMCPServer) (MCPServer, error)
	Delete(ctx context.Context, ownerID, id string) error
	GrantDep(ctx context.Context, ownerID, id, dep string) error
}

// MCPServer —— 一台已注册的外部 MCP server 在收口这一层的形状。
// 刻意**没有** auth header 的值:那是密钥,不出站。
type MCPServer struct {
	CreatedAt      time.Time
	ID             string
	Name           string
	URL            string
	AuthHeaderName string
}

// CreateMCPServer —— 注册一台 server 的入参(带密钥,只进不出)。
type CreateMCPServer struct {
	OwnerID         string
	Name            string
	URL             string
	AuthHeaderName  string
	AuthHeaderValue string
}

// MCPServers —— mcp_servers 资源:list / create / delete / grant_dep。
func MCPServers(store MCPServerStore) Resource {
	return Resource{Name: "mcp_servers", Ops: []Op{
		{
			ID:          "mcp_server_list",
			Description: "List all owner-registered external MCP servers.",
			InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      mcpServersList(store),
		},
		{
			ID: "mcp_server_create",
			Description: "Register an external MCP server (HTTP streamable). " +
				"Attach it to invite codes; visitors with that code get those tools.",
			InputSchema: mcpServerCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      mcpServersCreate(store),
		},
		{
			ID:          "mcp_server_delete",
			Description: "Delete a registered external MCP server by id.",
			InputSchema: mcpServerIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      mcpServersDelete(store),
		},
		{
			ID: "mcp_server_grant_dep",
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
			Kind:   fp.Action,
			Reach:  fp.OwnerAction(),
			Invoke: mcpServersGrantDep(store),
		},
	}}
}

var mcpServerIDSchema = json.RawMessage(`{
	"type":"object",
	"properties":{"server_id":{"type":"string","description":"Server id"}},
	"required":["server_id"]
}`)

var mcpServerCreateSchema = json.RawMessage(`{
	"type":"object",
	"properties":{
		"name":{"type":"string","description":"Server name, unique per owner."},
		"url":{"type":"string","description":"HTTP MCP endpoint URL (streamable HTTP)."},
		"auth_header_name":{"type":"string",
			"description":"Optional auth header name (e.g. 'Authorization')."},
		"auth_header_value":{"type":"string",
			"description":"Optional auth header value. Stored encrypted, never returned."}
	},
	"required":["name","url"]
}`)

// mcpServerRow —— 出站载荷形状(两个面同一份)。
type mcpServerRow struct {
	CreatedAt      string `json:"created_at"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	AuthHeaderName string `json:"auth_header_name,omitempty"`
}

func toMCPServerRow(s *MCPServer) mcpServerRow {
	return mcpServerRow{
		ID: s.ID, Name: s.Name, URL: s.URL, AuthHeaderName: s.AuthHeaderName,
		CreatedAt: s.CreatedAt.Format(time.RFC3339),
	}
}

func mcpServersList(store MCPServerStore) Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := store.List(ctx, ownerID)
		if err != nil {
			return nil, fmt.Errorf("list mcp servers: %w", err)
		}
		out := make([]mcpServerRow, 0, len(rows))
		for i := range rows {
			out = append(out, toMCPServerRow(&rows[i]))
		}
		return marshalOut(out)
	}
}

type mcpServerCreateArgs struct {
	Name            string `json:"name"`
	URL             string `json:"url"`
	AuthHeaderName  string `json:"auth_header_name"`
	AuthHeaderValue string `json:"auth_header_value"`
}

func parseMCPServerCreate(raw json.RawMessage) (mcpServerCreateArgs, error) {
	var in mcpServerCreateArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	if in.Name == "" || in.URL == "" {
		return in, BadInput("name and url are required")
	}
	return in, nil
}

func mcpServersCreate(store MCPServerStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseMCPServerCreate(raw)
		if perr != nil {
			return nil, perr
		}
		cfg, err := store.Create(ctx, &CreateMCPServer{
			OwnerID: ownerID, Name: in.Name, URL: in.URL,
			AuthHeaderName: in.AuthHeaderName, AuthHeaderValue: in.AuthHeaderValue,
		})
		if err != nil {
			return nil, fmt.Errorf("create mcp server: %w", err)
		}
		row := toMCPServerRow(&cfg)
		return marshalOut(row)
	}
}

type mcpServerIDArgs struct {
	ServerID string `json:"server_id"`
}

func mcpServersDelete(store MCPServerStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		var in mcpServerIDArgs
		if err := json.Unmarshal(raw, &in); err != nil {
			return nil, BadInput("invalid arguments: " + err.Error())
		}
		if in.ServerID == "" {
			return nil, BadInput("server_id is required")
		}
		if err := store.Delete(ctx, ownerID, in.ServerID); err != nil {
			return nil, fmt.Errorf("delete mcp server: %w", err)
		}
		return marshalOut(map[string]string{"server_id": in.ServerID})
	}
}

// grantedDep —— grant 的回包(具名而不是 map[string]any:any 在业务代码里是禁的,
// 而且具名之后这份契约在类型里就能看见)。
type grantedDep struct {
	ServerID string `json:"server_id"`
	Dep      string `json:"dep"`
	Granted  bool   `json:"granted"`
}

type mcpServerGrantDepArgs struct {
	ServerID string `json:"server_id"`
	Dep      string `json:"dep"`
}

func parseGrantDep(raw json.RawMessage) (mcpServerGrantDepArgs, error) {
	var in mcpServerGrantDepArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, BadInput("invalid arguments: " + err.Error())
	}
	if in.ServerID == "" {
		return in, BadInput("server_id is required")
	}
	if in.Dep == "" {
		return in, BadInput("dep is required")
	}
	return in, nil
}

func mcpServersGrantDep(store MCPServerStore) Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := parseGrantDep(raw)
		if perr != nil {
			return nil, perr
		}
		if err := store.GrantDep(ctx, ownerID, in.ServerID, in.Dep); err != nil {
			return nil, fmt.Errorf("grant mcp server dep: %w", err)
		}
		return marshalOut(grantedDep{ServerID: in.ServerID, Dep: in.Dep, Granted: true})
	}
}
