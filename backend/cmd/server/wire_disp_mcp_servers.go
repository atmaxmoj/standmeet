// wire_disp_mcp_servers.go —— marketplace 域的 ext-MCP server 普通函数 → 出站收口的窄口。

package main

import (
	"context"
	"errors"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/dispatcher"
)

type mcpServerOps struct{ deps marketplace.MCPServersDeps }

func newMCPServerOps(d *runtimeDeps) mcpServerOps {
	return mcpServerOps{deps: marketplace.MCPServersDeps{
		Servers: d.mcpServerRepo, Codes: d.codeRepo,
	}}
}

func (a mcpServerOps) List(
	ctx context.Context, ownerID string,
) ([]dispatcher.MCPServer, error) {
	rows, err := marketplace.ListMCPServers(ctx, a.deps, ownerID)
	if err != nil {
		return nil, mcpServerErr(err)
	}
	out := make([]dispatcher.MCPServer, 0, len(rows))
	for i := range rows {
		out = append(out, toDispatcherMCPServer(&rows[i]))
	}
	return out, nil
}

func (a mcpServerOps) Create(
	ctx context.Context, in *dispatcher.CreateMCPServer,
) (dispatcher.MCPServer, error) {
	cfg, err := marketplace.CreateMCPServer(ctx, a.deps, &marketplace.CreateMCPServerReq{
		OwnerID: in.OwnerID, Name: in.Name, URL: in.URL,
		AuthHeaderName: in.AuthHeaderName, AuthHeaderValue: in.AuthHeaderValue,
	})
	if err != nil {
		return dispatcher.MCPServer{}, mcpServerErr(err)
	}
	return toDispatcherMCPServer(&cfg), nil
}

func (a mcpServerOps) Delete(ctx context.Context, ownerID, id string) error {
	return mcpServerErr(marketplace.DeleteMCPServer(ctx, a.deps, ownerID, id))
}

func (a mcpServerOps) GrantDep(ctx context.Context, ownerID, id, dep string) error {
	return mcpServerErr(marketplace.GrantMCPServerDep(ctx, a.deps, ownerID, id, dep))
}

func toDispatcherMCPServer(s *marketplace.MCPServerConfig) dispatcher.MCPServer {
	return dispatcher.MCPServer{
		ID: s.ID, Name: s.Name, URL: s.URL,
		AuthHeaderName: s.AuthHeaderName, CreatedAt: s.CreatedAt,
	}
}

func mcpServerErr(err error) error {
	if err == nil {
		return nil
	}
	if classed := classifyMCPServerErr(err); classed != nil {
		return classed
	}
	return fmt.Errorf("mcp server op: %w", err)
}

func classifyMCPServerErr(err error) error {
	for _, c := range mcpServerErrClasses {
		if errors.Is(err, c.sentinel) {
			return c.as()
		}
	}
	return nil
}

var mcpServerErrClasses = []struct {
	sentinel error
	as       func() error
}{
	{apierr.ErrEmptyField, func() error {
		return dispatcher.BadInput("name and url are required")
	}},
	{marketplace.ErrMCPServerNotFound, func() error {
		return dispatcher.NotFound("mcp server not found")
	}},
	{marketplace.ErrMCPServerNameTaken, func() error {
		return dispatcher.Conflict("mcp server name already taken")
	}},
}
