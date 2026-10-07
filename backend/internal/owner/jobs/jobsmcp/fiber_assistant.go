// fiber_assistant.go —— assistant.push: the desktop cue app streams what it heard and the cue
// cards it wrote to /admin/screen-assistant (see owner/jobs/cues).

package jobsmcp

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/infra/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

type assistantFiber struct {
	store *cues.Store
	log   *slog.Logger
}

// NewAssistantFiber —— the screen assistant's owner-MCP fiber.
func NewAssistantFiber(store *cues.Store, log *slog.Logger) registry.Fiber {
	return &assistantFiber{store: store, log: log}
}

func (*assistantFiber) ID() string            { return "assistant.bundle" }
func (*assistantFiber) Shape() registry.Shape { return registry.ShapeOwnerOnly }
func (*assistantFiber) VisitorBinding(
	_ context.Context, _ *registry.AssembleInput,
) (*registry.Binding, error) {
	return nil, registry.ErrHidden
}

func (*assistantFiber) SystemPromptFragment(_ context.Context, _ *registry.AssembleInput) string {
	return ""
}

func (*assistantFiber) SystemPromptFragmentID(_ context.Context, _ *registry.AssembleInput) string {
	return ""
}

func (c *assistantFiber) OwnerMCPBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{{
		Name: "assistant.push", Danger: "write",
		Description: "Stream one screen-assistant event to /admin/screen-assistant. " +
			"kind=heard is a transcript line; kind=cue is a cue card — push the growing " +
			"text under the same id, the page keeps the latest.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Event id; a streamed cue reuses it."},
				"kind":{"type":"string","enum":["heard","cue"]},
				"text":{"type":"string"}
			},
			"required":["id","kind","text"]
		}`),
		Handler: c.handlePush,
	}}
}

func (c *assistantFiber) handlePush(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var e cues.Event
	if err := json.Unmarshal(raw, &e); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	if err := c.store.Push(ctx, ownerID, &e); err != nil {
		if cues.IsBadEvent(err) {
			return registry.MCPError(err.Error())
		}
		c.log.Error("cap assistant.push", "err", err)
		return registry.MCPError("assistant.push failed")
	}
	return mcputil.MarshalResult(c.log, "assistant.push", map[string]int64{"seq": e.Seq})
}
