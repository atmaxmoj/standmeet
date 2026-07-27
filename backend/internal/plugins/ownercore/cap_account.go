package ownercore

// cap_account.go —— owner account settings 的 owner-MCP 面。1 tool:
// account.set_full_name（改 owner 的 display full_name，复用 admin PATCH
// /account/full-name 同 usecase）。owner-only。单独一个 cap 而不是挂到 me.go，
// 保 me.go 行为不动（#135 说明 me 的语义 UNCHANGED）。

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner"
)

const capAccountBundle = "account.bundle"

type accountCapability struct {
	account owner.AccountDeps
	log     *slog.Logger
}

func newAccountCapability(account owner.AccountDeps, log *slog.Logger) *accountCapability {
	return &accountCapability{account: account, log: log}
}

func (*accountCapability) ID() string          { return capAccountBundle }
func (*accountCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }
func (*accountCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*accountCapability) SystemPromptFragment(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

func (*accountCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *accountCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{c.setFullNameBinding()}
}

func (c *accountCapability) setFullNameBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "account.set_full_name",
		Description: "Set the owner's display full name (non-empty, max 200 chars).",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{"full_name":{"type":"string","description":"Owner display name."}},
			"required":["full_name"]
		}`),
		Handler: c.handleSetFullName,
	}
}

type setFullNameArgsWire struct {
	FullName string `json:"full_name"`
}

func (c *accountCapability) handleSetFullName(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args setFullNameArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	updated, err := owner.UpdateOwnerFullName(ctx, c.account, ownerID, args.FullName)
	if err != nil {
		if errors.Is(err, apierr.ErrEmptyField) {
			return capreg.MCPError("full_name is required (max 200 chars)")
		}
		c.log.Error("cap account.set_full_name", "err", err)
		return capreg.MCPError("account.set_full_name failed")
	}
	return mcputil.MarshalResult(c.log, "account.set_full_name", map[string]string{
		"owner_id": updated.ID, "full_name": updated.FullName,
	})
}
