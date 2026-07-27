package ownercore

// cap_writings_unpublish.go —— writing_unpublish MCP tool (facade-parity paydown), split out of
// cap_writings.go to keep each file under the 350-line cap.

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/corpus"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcputil"
)

func (c *writingsCapability) unpublishBinding() *capreg.MCPBinding {
	return &capreg.MCPBinding{
		Name:        "writing_unpublish",
		Description: "Unpublish a writing (back to draft; hidden from visitors).",
		InputSchema: writingByIDSchema(),
		Handler:     c.handleUnpublish,
	}
}

func (c *writingsCapability) handleUnpublish(
	ctx context.Context, ownerID string, raw json.RawMessage,
) capreg.MCPResult {
	var args writingByIDArgsWire
	if err := json.Unmarshal(raw, &args); err != nil {
		return capreg.MCPError("invalid arguments: " + err.Error())
	}
	if args.WritingID == "" {
		return capreg.MCPError("writing_id is required")
	}
	wg, err := corpus.UnpublishWriting(ctx, *c.ro, ownerID, args.WritingID)
	if err != nil {
		c.log.Error("cap writing_unpublish", "err", err)
		return capreg.MCPError("unpublish writing failed")
	}
	return mcputil.MarshalResult(c.log, "writing_unpublish", map[string]any{
		"writing_id": wg.ID(), "slug": wg.Slug(), "published": false,
	})
}
