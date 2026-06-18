// cap_me.go —— Phase B-4 pilot: 把 `me` tool 从 server.go AddTool 调用迁
// 成 capreg.Capability + OwnerMCPBinding。owner-only (访客侧不暴露)。
//
// 后续 corpus / output / promote / writings / skills / prompts / roles /
// mcp_servers / chat / seo / page / jobs / resume / applications 一个个
// 按同模式迁。

package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

const capOwnerMe = "owner.me"

type meCapability struct {
	owners OwnerLookup
	log    *slog.Logger
}

func newMeCapability(owners OwnerLookup, log *slog.Logger) *meCapability {
	return &meCapability{owners: owners, log: log}
}

func (*meCapability) ID() string { return capOwnerMe }
func (*meCapability) Shape() capreg.Shape {
	return capreg.ShapeOwnerOnly
}

func (*meCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*meCapability) SystemPromptFragment(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (*meCapability) SystemPromptFragmentID(
	_ context.Context, _ *capreg.AssembleInput,
) string {
	return ""
}

func (c *meCapability) OwnerMCPBindings() []*capreg.MCPBinding {
	return []*capreg.MCPBinding{{
		Name:        "me",
		Description: "Return the currently authenticated StandMeet owner.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleMe,
	}}
}

func (c *meCapability) handleMe(
	ctx context.Context, ownerID string, _ json.RawMessage,
) capreg.MCPResult {
	owner, err := c.owners.GetByID(ctx, ownerID)
	if err != nil {
		if errors.Is(err, domain.ErrOwnerNotFound) {
			return capreg.MCPError("owner not found")
		}
		c.log.Error("mcp me failed", "err", err)
		return capreg.MCPError("internal error")
	}
	return capreg.MCPSuccess(formatOwner(&owner))
}
