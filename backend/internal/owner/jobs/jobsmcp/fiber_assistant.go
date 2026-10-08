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

// assistantFiber —— assistant.push; OwnerOps (ops.go) lifts it into a dispatcher op.
type assistantFiber struct {
	store *cues.Store
	log   *slog.Logger
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
