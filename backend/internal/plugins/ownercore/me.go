// me.go —— the `me` owner-MCP capability, externalized from core `mcphandle` into this plugin
// (#135 pilot). Behavior is UNCHANGED from the old mcphandle/cap_me.go: same tool name, same
// schema, same output. Only the registration source moved (core `MustRegister` → this plugin's
// `RegisterCapabilities`). The narrow `OwnerLookup` + `formatOwner` live here so the plugin is
// self-contained (no import of mcphandle).

package ownercore

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/capreg"
	"github.com/atmaxmoj/standmeet/internal/ownerdomain"
)

const capOwnerMe = "owner.me"

// OwnerLookup —— the plugin's own narrow dependency; *postgres.OwnerRepo satisfies it.
type OwnerLookup interface {
	GetByID(ctx context.Context, ownerID string) (ownerdomain.Owner, error)
}

type meCapability struct {
	owners OwnerLookup
	log    *slog.Logger
}

func newMeCapability(owners OwnerLookup, log *slog.Logger) *meCapability {
	return &meCapability{owners: owners, log: log}
}

func (*meCapability) ID() string          { return capOwnerMe }
func (*meCapability) Shape() capreg.Shape { return capreg.ShapeOwnerOnly }

func (*meCapability) VisitorBinding(
	_ context.Context, _ *capreg.AssembleInput,
) (*capreg.Binding, error) {
	return nil, capreg.ErrHidden
}

func (*meCapability) SystemPromptFragment(_ context.Context, _ *capreg.AssembleInput) string {
	return ""
}

func (*meCapability) SystemPromptFragmentID(_ context.Context, _ *capreg.AssembleInput) string {
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
		if errors.Is(err, ownerdomain.ErrOwnerNotFound) {
			return capreg.MCPError("owner not found")
		}
		c.log.Error("mcp me failed", "err", err)
		return capreg.MCPError("internal error")
	}
	return capreg.MCPSuccess(formatOwner(&owner))
}

// formatOwner —— serialize the owner profile for the `me` tool result.
func formatOwner(o *ownerdomain.Owner) string {
	return `{"owner_id":"` + o.ID + `","email":"` + o.Email +
		`","handle":"` + o.Handle + `","full_name":"` + o.FullName + `"}`
}
