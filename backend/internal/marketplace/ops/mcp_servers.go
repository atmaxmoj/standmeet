// Package ops —— marketplace 域对外能做的事,由域自己声明。
//
// 一个操作在这里是完整的一份:id、说明、入参 schema、语义类别、暴露意图、实现。
// 收口只负责汇聚、加装饰器、投影到各个面。
package ops

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/entity"
	"github.com/atmaxmoj/standmeet/internal/marketplace/usecase"
)

var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// MCPServers —— owner 注册的外部 MCP server(HTTP streamable)。挂到 role 上,带那个码
// 进来的访客就拿到那台 server 的工具。
//
// ext-MCP 是**信任最低**的一档:它的工具如果声明了 connector 依赖,默认不注入,要 owner
// 显式 grant 一次。所以 grant 是独立的一个操作,不是 create 的一个字段。
//
// auth_header_value 只进不出:它是密钥,加密存,出站形状里根本没有这个字段。
func MCPServers(deps usecase.MCPServersDeps) []fp.Op {
	return []fp.Op{
		{
			ID:          "mcp_server_list",
			Description: "List all owner-registered external MCP servers.",
			InputSchema: noArgs,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      listMCPServers(deps),
		},
		{
			ID: "mcp_server_create",
			Description: "Register an external MCP server (HTTP streamable). Attach it to " +
				"invite codes; visitors with that code get those tools.",
			InputSchema: mcpServerCreateSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      createMCPServer(deps),
		},
		{
			ID:          "mcp_server_delete",
			Description: "Delete a registered external MCP server by id.",
			InputSchema: mcpServerIDSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      deleteMCPServer(deps),
		},
		{
			ID: "mcp_server_check",
			Description: "Ask a registered MCP server whether it answers, and what tools it " +
				"offers. Read-only: it dials and lists, it changes nothing. Use it after " +
				"registering one and before attaching it to a role — otherwise the URL you " +
				"pasted is the only evidence you have.",
			InputSchema: mcpServerIDSchema,
			Kind:        fp.Read,
			Reach:       fp.OwnerRead(),
			Invoke:      checkMCPServer(deps),
		},
		{
			ID: "mcp_server_grant_dep",
			Description: "Grant this ext-MCP server a connector dependency. ext-MCP is " +
				"lowest-trust: tools declaring Requires stay uninjected until the owner " +
				"grants the dep here. Idempotent; the server must belong to the owner.",
			InputSchema: mcpServerGrantSchema,
			Kind:        fp.Action,
			Reach:       fp.OwnerAction(),
			Invoke:      grantMCPServerDep(deps),
		},
	}
}

var (
	mcpServerIDSchema = json.RawMessage(`{
		"type":"object",
		"properties":{"server_id":{"type":"string","description":"Server id."}},
		"required":["server_id"]
	}`)

	mcpServerCreateSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"name":{"type":"string","description":"Server name, unique per owner."},
			"url":{"type":"string","description":"HTTP MCP endpoint URL (streamable HTTP)."},
			"auth_header_name":{"type":"string",
				"description":"Optional auth header name, e.g. 'Authorization'."},
			"auth_header_value":{"type":"string",
				"description":"Optional auth header value. Stored encrypted, never returned."}
		},
		"required":["name","url"]
	}`)

	mcpServerGrantSchema = json.RawMessage(`{
		"type":"object",
		"properties":{
			"server_id":{"type":"string","description":"Server id."},
			"dep":{"type":"string","description":"Connector dependency name to grant."}
		},
		"required":["server_id","dep"]
	}`)
)

// mcpServerOut —— 出站形状(两个面同一份)。刻意**没有** auth header 的值。
type mcpServerOut struct {
	CreatedAt      string `json:"created_at"`
	ID             string `json:"id"`
	Name           string `json:"name"`
	URL            string `json:"url"`
	AuthHeaderName string `json:"auth_header_name,omitempty"`
}

func toMCPServerOut(s *entity.MCPServerConfig) mcpServerOut {
	return mcpServerOut{
		ID: s.ID, Name: s.Name, URL: s.URL, AuthHeaderName: s.AuthHeaderName,
		CreatedAt: s.CreatedAt.Format(time.RFC3339),
	}
}

func listMCPServers(deps usecase.MCPServersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, _ json.RawMessage) (json.RawMessage, error) {
		rows, err := usecase.ListMCPServers(ctx, deps, ownerID)
		if err != nil {
			return nil, mcpServerErr(err)
		}
		out := make([]mcpServerOut, 0, len(rows))
		for i := range rows {
			out = append(out, toMCPServerOut(&rows[i]))
		}
		return json.Marshal(out)
	}
}

type mcpServerArgs struct {
	Name            string `json:"name"`
	URL             string `json:"url"`
	AuthHeaderName  string `json:"auth_header_name"`
	AuthHeaderValue string `json:"auth_header_value"`
	ServerID        string `json:"server_id"`
	Dep             string `json:"dep"`
}

func decodeMCPServerArgs(raw json.RawMessage) (mcpServerArgs, error) {
	var in mcpServerArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, nil
}

func createMCPServer(deps usecase.MCPServersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeMCPServerCreate(raw)
		if perr != nil {
			return nil, perr
		}
		cfg, err := usecase.CreateMCPServer(ctx, deps, &usecase.CreateMCPServerReq{
			OwnerID: ownerID, Name: in.Name, URL: in.URL,
			AuthHeaderName: in.AuthHeaderName, AuthHeaderValue: in.AuthHeaderValue,
		})
		if err != nil {
			return nil, mcpServerErr(err)
		}
		return json.Marshal(toMCPServerOut(&cfg))
	}
}

func decodeMCPServerCreate(raw json.RawMessage) (mcpServerArgs, error) {
	in, perr := decodeMCPServerArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs([2]string{"name", in.Name}, [2]string{"url", in.URL})
}

// probeOut —— 探针的回执。具名类型:这份契约在类型里就看得见(同 grantedDep)。
type probeOut struct {
	Tools []string `json:"tools"`
}

// emptyIfNil —— nil slice 会编码成 `null`,而读它的那一侧把 `null` 当成「坏了」。
// 「答上了但一个工具都没有」是个**答案**,它的形状是 `[]`。
func emptyIfNil(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// checkMCPServer —— 探针的出站形状：**工具名的清单**，不是一个数字。
//
// owner 要确认的是「这台是不是我想挂的那一台」——「3 个工具」确认不了，
// `ext_deepwiki_ask_question` 一眼就认得出来。
func checkMCPServer(deps usecase.MCPServersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeMCPServerArgs(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"server_id", in.ServerID}); err != nil {
			return nil, err
		}
		res, cerr := usecase.CheckMCPServer(ctx, deps, ownerID, in.ServerID)
		if cerr != nil {
			return nil, mcpServerErr(cerr)
		}
		return json.Marshal(probeOut{Tools: emptyIfNil(res.Tools)})
	}
}

func deleteMCPServer(deps usecase.MCPServersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeMCPServerArgs(raw)
		if perr != nil {
			return nil, perr
		}
		if err := fp.RequireArgs([2]string{"server_id", in.ServerID}); err != nil {
			return nil, err
		}
		if err := usecase.DeleteMCPServer(ctx, deps, ownerID, in.ServerID); err != nil {
			return nil, mcpServerErr(err)
		}
		return json.Marshal(map[string]string{"server_id": in.ServerID})
	}
}

// grantedDep —— grant 的回执。具名而不是 map:这份契约在类型里就能看见。
type grantedDep struct {
	ServerID string `json:"server_id"`
	Dep      string `json:"dep"`
	Granted  bool   `json:"granted"`
}

func grantMCPServerDep(deps usecase.MCPServersDeps) fp.Invoke {
	return func(ctx context.Context, ownerID string, raw json.RawMessage) (json.RawMessage, error) {
		in, perr := decodeMCPServerGrant(raw)
		if perr != nil {
			return nil, perr
		}
		if err := usecase.GrantMCPServerDep(ctx, deps, ownerID, in.ServerID, in.Dep); err != nil {
			return nil, mcpServerErr(err)
		}
		return json.Marshal(grantedDep{ServerID: in.ServerID, Dep: in.Dep, Granted: true})
	}
}

func decodeMCPServerGrant(raw json.RawMessage) (mcpServerArgs, error) {
	in, perr := decodeMCPServerArgs(raw)
	if perr != nil {
		return in, perr
	}
	return in, fp.RequireArgs([2]string{"server_id", in.ServerID}, [2]string{"dep", in.Dep})
}

// mcpServerErr —— 域的哨兵 → 协议无关的类别。code 是已经发出去的契约,显式钉住。
func mcpServerErr(err error) error {
	for _, c := range mcpServerErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return fp.OpErr("mcp server op", err)
}

var mcpServerErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error {
		return fp.BadInput("name and url are required")
	}},
	{entity.ErrMCPServerNotFound, func() error {
		return fp.Coded(fp.NotFound("mcp server not found"), "mcp_server_not_found")
	}},
	{entity.ErrMCPServerNameTaken, func() error {
		return fp.Coded(fp.Conflict("mcp server name already taken"), "mcp_server_name_taken")
	}},
	// 探针的两种失败（F-D-15）。**都是 BadInput 不是内部错**:owner 粘错一个 token 或一个
	// URL 是常态,而这两句以前一起落到 `fp.OpErr` → 500 → 屏幕上「no answer — internal error」。
	// code 分开发,因为 owner 要做的事不同:一个去改 token,一个去改 URL。
	{usecase.ErrMCPServerRefusedAuth, func() error {
		return fp.Coded(
			fp.BadInput("that server answered, but it rejected the auth header"),
			"mcp_server_refused_auth")
	}},
	{usecase.ErrMCPServerNoAnswer, func() error {
		return fp.Coded(
			fp.BadInput("nothing answered at that URL"), "mcp_server_no_answer")
	}},
}
