// Package ops — what the marketplace domain can do, declared by the domain itself.
//
// An operation here is one complete unit: id, description, input schema, semantic
// kind, exposure intent, implementation. The convergence point only aggregates,
// wraps decorators around, and projects onto each face.
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

// MCPServers — an external MCP server (HTTP streamable) the owner registered.
// Attach it to a role, and a visitor coming in with that code gets that server's
// tools.
//
// ext-MCP is the **lowest-trust** tier: if one of its tools declares a connector
// dependency, that dependency stays uninjected by default until the owner grants
// it explicitly. That's why grant is its own separate operation, not a field on
// create.
//
// auth_header_value goes in but never comes back out: it's a secret, stored
// encrypted, and the outbound shape simply has no field for it.
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

// mcpServerOut — the outbound shape (the same one for both faces). Deliberately
// has **no** auth header value.
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

// probeOut — the probe's receipt. A named type: this contract is visible right
// in the type (same as grantedDep).
type probeOut struct {
	Tools []string `json:"tools"`
}

// emptyIfNil — a nil slice would encode as `null`, and the reader on the other
// side treats `null` as "broken". "It answered, but has zero tools" is an
// **answer**, and its shape is `[]`.
func emptyIfNil(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

// checkMCPServer — the probe's outbound shape: **a list of tool names**, not
// a count.
//
// What the owner needs to confirm is "is this the server I meant to attach" —
// "3 tools" can't confirm that, but `ext_deepwiki_ask_question` is recognizable
// at a glance.
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

// grantedDep — grant's receipt. A named type rather than a map: this contract
// is visible right in the type.
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

// mcpServerErr — domain sentinel → protocol-agnostic category. The code is an
// already-shipped contract, pinned explicitly.
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
	// The probe's two failure modes (F-D-15). **Both are BadInput, not internal
	// errors**: an owner pasting in a wrong token or a wrong URL is a normal case,
	// but these two used to both fall into `fp.OpErr` → 500 → "no answer — internal
	// error" on screen. The codes are issued separately because what the owner
	// needs to do differs: one goes to fix the token, the other the URL.
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
