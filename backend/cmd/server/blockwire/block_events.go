// block_events.go —— block.installed and block.failed (docs/design/event-bus-outbox-webhooks.md,
// *Webhook event types*). Thin: subject block/<block id>, data {block_id}; never the stderr.

package blockwire

import (
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/plugin/blockadmin"
)

// Block event types.
const (
	BlockInstalled = "block.installed"
	BlockFailed    = "block.failed"
)

// EventTypes —— the block model's event types: supplier.* (declared by the supplier admin) and
// block.*.
func EventTypes() []events.Type {
	t := func(typ, desc string) events.Type {
		return events.Type{
			Type: typ, Description: desc, Subject: "block/<block id>", Exposure: events.Webhook,
		}
	}
	return append(blockadmin.EventTypes(),
		t(BlockInstalled, "The owner installed (or re-installed) a block (data.block_id)."),
		t(BlockFailed,
			"A block started failing to mount; repeats of the same failure stay quiet until it "+
				"mounts again (data.block_id)."),
	)
}

func blockData(id string) map[string]string { return map[string]string{"block_id": id} }
