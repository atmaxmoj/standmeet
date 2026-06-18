// cap_page.go —— Phase E-14b: owner-side page.update_handle parity tool。
// owner-only。让 AI 在 Claude Code 直接调 page.update_handle("new-handle")
// 改 owner 的 public handle (跟 /admin/account "change handle" 同 path)。
//
// 命名 page.* 而不是 owner.* —— owner 资源散在多处 (page handle / SEO
// settings / AI provider)，page.update_handle 专指 visitor 看到的 URL prefix。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/usecases"
)

const capPageBundle = "page.bundle"

type pageCapability struct {
	handle *usecases.HandleDeps
	log    *slog.Logger
}

func newPageCapability(
	handle *usecases.HandleDeps, log *slog.Logger,
) *pageCapability {
	return &pageCapability{handle: handle, log: log}
}

func (*pageCapability) ID() string          { return capPageBundle }
func (*pageCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*pageCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*pageCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*pageCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *pageCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{c.updateHandleBinding()}
}

func (c *pageCapability) updateHandleBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name: "page.update_handle",
		Description: "Change owner's public handle (URL prefix). New handle must be " +
			"2-64 chars of a-z0-9-. Old handle remains as alias (handle_aliases table) " +
			"so existing access codes / QR URLs keep working.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"handle":{"type":"string",
					"description":"New handle, 2-64 chars of a-z0-9-."}
			},
			"required":["handle"]
		}`),
		Handler: c.handleUpdateHandle,
	}
}

type updateHandleArgsWire struct {
	Handle string `json:"handle"`
}

func (c *pageCapability) handleUpdateHandle(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args updateHandleArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.Handle == "" {
		return capreg.MCPError("handle is required")
	}
	owner, err := usecases.UpdateOwnerHandle(ctx, *c.handle, ownerID, args.Handle)
	if err != nil {
		return updateHandleErrToResult(c.log, err)
	}
	return marshalCapResult(c.log, "page.update_handle", map[string]string{
		"owner_id": owner.ID, "handle": owner.Handle,
	})
}

func updateHandleErrToResult(log *slog.Logger, err error) capreg.MCPResult {
	if errors.Is(err, usecases.ErrEmptyField) {
		return capreg.MCPError("handle must be 2-64 chars of a-z0-9-")
	}
	if errors.Is(err, domain.ErrHandleTaken) {
		return capreg.MCPError("handle already taken")
	}
	log.Error("cap page.update_handle", "err", err)
	return capreg.MCPError("update handle failed")
}
