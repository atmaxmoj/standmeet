// fiber_assistant.go —— assistant.push: the desktop cue app streams what it heard and the cue
// cards it wrote to /admin/screen-assistant (see owner/jobs/cues). assistant.read gives the same
// feed back to the owner's AI.

package jobsmcp

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/infra/mcputil"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/cues"
	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// assistantFiber —— assistant.push + .read + .prepare + .context + .cue; OwnerOps (ops.go) lifts
// each into a dispatcher op.
type assistantFiber struct {
	asst *cues.Assistant
	log  *slog.Logger
}

func (c *assistantFiber) OwnerMCPBindings() []*registry.MCPBinding {
	return append(c.feedBindings(), c.cueBindings()...)
}

func (c *assistantFiber) feedBindings() []*registry.MCPBinding {
	return []*registry.MCPBinding{{
		Name: "assistant.push", Danger: "write",
		Description: "Stream one screen-assistant event to /admin/screen-assistant. " +
			"kind=heard is the other side's line: the desktop screen assistant writes a cue " +
			"card for it (an agent that wants the card back calls assistant.cue instead). " +
			"kind=said is the owner's own answer (transcript only). kind=cue is a cue card — " +
			"push the growing text under the same id, the page keeps the latest. " +
			"Read the cards back with assistant.read.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"id":{"type":"string","description":"Event id; a streamed cue reuses it."},
				"kind":{"type":"string","enum":["heard","said","cue"]},
				"text":{"type":"string"}
			},
			"required":["id","kind","text"]
		}`),
		Handler: c.handlePush,
	}, {
		Name: "assistant.read", Danger: "read",
		Description: "Read the screen-assistant feed: what it heard and the cue cards it wrote " +
			"(the last 12 hours). A streamed cue comes back once, with its latest text. Pass " +
			"since = last_seq from a previous read to get only what came after.",
		InputSchema: json.RawMessage(`{
			"type":"object",
			"properties":{
				"since":{"type":"integer",
					"description":"last_seq of a previous read; 0 or absent = from the start."}
			}
		}`),
		Handler: c.handleRead,
	}}
}

func (c *assistantFiber) handleRead(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var in struct {
		Since int64 `json:"since"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &in); err != nil {
			return registry.MCPError("invalid arguments: " + err.Error())
		}
	}
	events, err := c.asst.Feed.Since(ctx, ownerID, in.Since)
	if err != nil {
		c.log.Error("cap assistant.read", "err", err)
		return registry.MCPError("assistant.read failed")
	}
	last := in.Since
	if n := len(events); n > 0 {
		last = events[n-1].Seq
	}
	return mcputil.MarshalResult(c.log, "assistant.read", map[string]any{
		"events": cues.Latest(events), "last_seq": last,
	})
}

func (c *assistantFiber) handlePush(
	ctx context.Context, ownerID string, raw json.RawMessage,
) registry.MCPResult {
	var e cues.Event
	if err := json.Unmarshal(raw, &e); err != nil {
		return registry.MCPError("invalid arguments: " + err.Error())
	}
	if err := c.asst.Feed.Push(ctx, ownerID, &e); err != nil {
		if cues.IsBadEvent(err) {
			return registry.MCPError(err.Error())
		}
		c.log.Error("cap assistant.push", "err", err)
		return registry.MCPError("assistant.push failed")
	}
	return mcputil.MarshalResult(c.log, "assistant.push", map[string]int64{"seq": e.Seq})
}
