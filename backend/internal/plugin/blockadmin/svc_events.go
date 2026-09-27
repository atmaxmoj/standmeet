// svc_events.go —— the supplier event types, and the transaction a connection-state change and
// its event share (docs/design/event-bus-outbox-webhooks.md, *Webhook event types*). Thin: the
// subject is supplier/<supplier id>; never a credential or a token.

package blockadmin

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Supplier event types.
const (
	SupplierConnected    = "supplier.connected"
	SupplierDisconnected = "supplier.disconnected"
	SupplierActivated    = "supplier.activated"
)

// EventTypes —— the supplier event types.
func EventTypes() []events.Type {
	t := func(typ, desc string) events.Type {
		const subject = "supplier/<supplier id>"
		return events.Type{Type: typ, Description: desc, Subject: subject, Exposure: events.Webhook}
	}
	return []events.Type{
		t(SupplierConnected,
			"A supplier passed its connection check or OAuth grant (data.supplier_id)."),
		t(SupplierDisconnected, "A supplier was disconnected (data.supplier_id)."),
		t(SupplierActivated, "A supplier took its seam's active slot (data.supplier_id)."),
	}
}

// inTx —— fn with a copy of the service whose connection writes and recorder join one
// transaction.
func (s *Service) inTx(ctx context.Context, fn func(t *Service) error) error {
	//nolint:wrapcheck // InTx names begin/commit; fn names its steps
	return pgstore.InTx(ctx, s.d.Repo.Pool(), func(tx pgstore.Tx) error {
		d := *s.d
		d.Repo, d.Events = s.d.Repo.With(tx), s.d.Events.With(tx)
		return fn(&Service{d: &d})
	})
}

// setActive —— claims the seam slot for id and records supplier.activated.
func (s *Service) setActive(ctx context.Context, ownerID, id, seam string) error {
	if err := s.d.Repo.SetActive(ctx, ownerID, id, seam); err != nil {
		return err //nolint:wrapcheck // callers name the step
	}
	return s.record(ctx, SupplierActivated, ownerID, id)
}

func (s *Service) record(ctx context.Context, typ, ownerID, id string) error {
	data := map[string]string{"supplier_id": id}
	//nolint:wrapcheck // Record names the type
	return s.d.Events.Record(ctx, ownerID, typ, "supplier/"+id, data)
}
