// Package supplier -- controller for "supplier.invoke". A network-isolated sandboxed block calls
// one verb of the owner's active supplier, by seam name, over a unix socket. This is the
// **controller layer of the socket inbound API** (same layer as the HTTP controllers under
// internal/routes/): a thin shell -- it only parses socket args and forwards into the supplier
// business domain (Invoker, satisfied by the business domain's Suppliers struct). Business
// logic stays in internal/plugin/adapters, not here. The composition root wires this in for
// every block that needs a supplier.
package supplier

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// Invoker -- invokes a supplier by seam (seam+verb+args -> json). The business domain's
// Suppliers struct satisfies it.
//
// InvokeBackground -- returns immediately; the call runs in the background and retries per
// policy. Use it for calls where "the result must not block the caller" (e.g. an owner
// notification after a booking is confirmed). **Must be host-held**: a sandboxed block's
// process lives only for that one call, so a retry goroutine started inside it is reclaimed
// along with the process.
type Invoker interface {
	Invoke(
		ctx context.Context, ownerID, seam, verb string, args json.RawMessage,
	) (json.RawMessage, error)
	InvokeBackground(
		ctx context.Context, ownerID, seam, verb string, args json.RawMessage,
	)
}

// Ops -- supplier.invoke. The block says "do this for me with the calendar"; the host finds
// the owner's currently active supplier for that seam and does it -- the block doesn't
// know which specific supplier, and credentials never leave the host.
//
// background=true -> returns {ok:true} immediately without waiting for the result; the call runs
// in the host background (with retries).
func Ops(inv Invoker) []hostop.Op {
	return []hostop.Op{{
		Name: "supplier.invoke",
		Description: "Ask the owner's active supplier for a seam to do one verb. " +
			"The block names a seam, never a supplier; credentials stay host-side.",
		Invoke: invokeHandler(inv),
	}}
}

func invokeHandler(inv Invoker) hostop.Invoke {
	return func(
		ctx context.Context, raw json.RawMessage,
	) (json.RawMessage, error) {
		var req struct {
			OwnerID    string          `json:"owner_id"`
			Seam       string          `json:"seam"`
			Verb       string          `json:"verb"`
			Args       json.RawMessage `json:"args"`
			Background bool            `json:"background"`
		}
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("supplier.invoke: decode: %w", err)
		}
		if req.Background {
			inv.InvokeBackground(ctx, req.OwnerID, req.Seam, req.Verb, req.Args)
			return json.RawMessage(`{"ok":true,"background":true}`), nil
		}
		out, err := inv.Invoke(ctx, req.OwnerID, req.Seam, req.Verb, req.Args)
		if err != nil {
			// Name the owner/seam/verb: "not configured" is meaningless without knowing WHICH
			// owner was asked about — a stale or wrong owner id looks identical to a missing
			// supplier from here.
			// `%w` wraps the error the **business domain has already classified**
			// (`hostop.Fault`) -- so the class passes through this layer intact, all the
			// way to the `code` field on the socket envelope.
			// Classification doesn't happen here: this thin shell is designed not to know any
			// of the supplier domain's sentinels (`supplierroutes: mayDependOn: [hostop]`);
			// judging it here would mean pulling the domain in.
			return nil, fmt.Errorf("supplier.invoke %s/%s owner=%s: %w",
				req.Seam, req.Verb, req.OwnerID, err)
		}
		return out, nil
	}
}
