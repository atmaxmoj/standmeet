// cap_me.go —— Phase B-4 pilot: 把 `me` tool 从 server.go AddTool 调用迁
// 成 agentskills.Capability + OwnerMCPBinding。owner-only (访客侧不暴露)。
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

	"github.com/wangsijie/standmeet/internal/agentskills"
	"github.com/wangsijie/standmeet/internal/domain"
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
func (*meCapability) Shape() agentskills.Shape {
	return agentskills.ShapeOwnerOnly
}

func (*meCapability) VisitorBinding(
	_ context.Context, _ *agentskills.AssembleInput,
) (*agentskills.Binding, error) {
	return nil, agentskills.ErrHidden
}

func (*meCapability) SystemPromptFragment(
	_ context.Context, _ *agentskills.AssembleInput,
) string {
	return ""
}

func (c *meCapability) OwnerMCPBinding() *agentskills.MCPBinding {
	return &agentskills.MCPBinding{
		Name:        "me",
		Description: "Return the currently authenticated StandMeet owner.",
		InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
		Handler:     c.handleMe,
	}
}

func (c *meCapability) handleMe(
	ctx context.Context, ownerID string, _ json.RawMessage,
) agentskills.MCPResult {
	owner, err := c.owners.GetByID(ctx, ownerID)
	if err != nil {
		if errors.Is(err, domain.ErrOwnerNotFound) {
			return agentskills.MCPError("owner not found")
		}
		c.log.Error("mcp me failed", "err", err)
		return agentskills.MCPError("internal error")
	}
	return agentskills.MCPSuccess(formatOwner(&owner))
}
