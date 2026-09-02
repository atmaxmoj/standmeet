// Package connector -- controller for "connector.invoke". A network-isolated sandboxed cap calls
// one verb of the owner's active connector, by name (category), over a unix socket. This is the
// **controller layer of the socket inbound API** (same layer as the HTTP controllers under
// internal/routes/): a thin shell -- it only parses socket args and forwards into the connector
// business domain (Invoker, satisfied by the business domain's connector.Slots struct). Business
// logic stays in internal/connector, not here. The composition root wires this in for every cap
// that needs a connector.
package connector

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// Invoker -- invokes a connector by name (category+verb+args -> json). The business domain's
// connector.Slots struct satisfies it.
//
// InvokeBackground -- returns immediately; the call runs in the background and retries per
// policy. Use it for calls where "the result must not block the caller" (e.g. an owner
// notification after a booking is confirmed). **Must be host-held**: a sandboxed capability's
// process lives only for that one call, so a retry goroutine started inside it is reclaimed
// along with the process.
type Invoker interface {
	Invoke(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	) (json.RawMessage, error)
	InvokeBackground(
		ctx context.Context, ownerID, category, verb string, args json.RawMessage,
	)
}

// Ops -- connector.invoke. The capability says "do this for me with the calendar"; the host finds
// the owner's currently active connector for that category and does it -- the capability doesn't
// know which specific connector, and credentials never leave the host.
//
// background=true -> returns {ok:true} immediately without waiting for the result; the call runs
// in the host background (with retries).
func Ops(inv Invoker) []hostop.Op {
	return []hostop.Op{{
		Name: "connector.invoke",
		Description: "Ask the owner's active connector for a category to do one verb. " +
			"The capability names a category, never a connector; credentials stay host-side.",
		Invoke: invokeHandler(inv),
	}}
}

func invokeHandler(inv Invoker) hostop.Invoke {
	return func(
		ctx context.Context, raw json.RawMessage,
	) (json.RawMessage, error) {
		var req struct {
			OwnerID    string          `json:"owner_id"`
			Category   string          `json:"category"`
			Verb       string          `json:"verb"`
			Args       json.RawMessage `json:"args"`
			Background bool            `json:"background"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("connector.invoke: decode: %w", err)
		}
		if req.Background {
			inv.InvokeBackground(ctx, req.OwnerID, req.Category, req.Verb, req.Args)
			return json.RawMessage(`{"ok":true,"background":true}`), nil
		}
		out, err := inv.Invoke(ctx, req.OwnerID, req.Category, req.Verb, req.Args)
		if err != nil {
			// Name the owner/category/verb: "not configured" is meaningless without knowing WHICH
			// owner was asked about — a stale or wrong owner id looks identical to a missing
			// connector from here.
			// `%w` wraps the error the **business domain has already classified**
			// (`hostop.Fault`) -- so the category passes through this layer intact, all the
			// way to the `code` field on the socket envelope.
			// Classification doesn't happen here: this thin shell is designed not to know any
			// of the connector domain's sentinels (`connectorroutes: mayDependOn: [hostop]`);
			// judging it here would mean pulling the domain in.
			return nil, fmt.Errorf("connector.invoke %s/%s owner=%s: %w",
				req.Category, req.Verb, req.OwnerID, err)
		}
		return out, nil
	}
}
