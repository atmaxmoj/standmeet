// events.go —— the owner-domain event types (docs/design/event-bus-outbox-webhooks.md,
// *Webhook event types*). Thin: never an address, a phrase, a token or a document's content.
// Each is recorded by the use case that makes the fact, in the fact's own transaction.

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
)

// Event types.
const (
	OwnerLogin                = "owner.login"
	OwnerEmailChanged         = "owner.email_changed"
	OwnerRecoveryRequested    = "owner.recovery_requested"
	VaultImported             = "vault.imported"
	GasExhausted              = "gas.exhausted"
	GasRefilled               = "gas.refilled"
	PagePromotedLive          = "page.promoted_live"
	PageRolledBack            = "page.rolled_back"
	PageUnpublished           = "page.unpublished"
	MicrositeStoreDocInserted = "microsite.store.doc_inserted"
	MicrositeStoreDocDeleted  = "microsite.store.doc_deleted"
	MicrositeStoreDocApproved = "microsite.store.doc_approved"
)

// OwnerEventTypes —— the owner-domain event types.
func OwnerEventTypes() []events.Type {
	t := func(typ, desc, subject string) events.Type {
		return events.Type{Type: typ, Description: desc, Subject: subject, Exposure: events.Webhook}
	}
	owner, gas, page := "owner/<owner id>", "provider/<provider id>", "microsite/<slug>"
	return []events.Type{
		t(OwnerLogin, "The owner signed in with the password.", owner),
		t(OwnerEmailChanged, "The owner's sign-in email changed (never the address).", owner),
		t(OwnerRecoveryRequested, "The owner generated a new recovery phrase.", owner),
		t(VaultImported, "A vault sync finished (data.created, data.updated, data.deleted).",
			"vault/<owner id>"),
		t(GasExhausted,
			"A metered provider's tank ran dry; its visitors are refused (data.provider_id).",
			gas),
		t(GasRefilled, "A metered provider's tank was refilled (data.provider_id).", gas),
		t(PagePromotedLive,
			"A microsite build went live (data.microsite_id, data.build_id).", page),
		t(PageRolledBack,
			"A microsite went back to its previous build (data.microsite_id, data.build_id).",
			page),
		t(PageUnpublished, "A microsite was taken offline (data.microsite_id).", page),
		t(MicrositeStoreDocInserted,
			"A visitor added a document to a microsite's store (data.collection, data.doc_id).",
			page),
		t(MicrositeStoreDocDeleted,
			"The owner removed a document from a microsite's store (data.collection, "+
				"data.doc_id).", page),
		t(MicrositeStoreDocApproved,
			"The owner approved a document that waited for review; visitors now see it "+
				"(data.collection, data.doc_id).", page),
	}
}

// ownerFacts —— the owner row and the outbox an owner.* fact goes into: record writes on the row
// and records typ, in one transaction.
type ownerFacts struct {
	owners *repo.Repo
	rec    events.Recorder
}

func (f ownerFacts) record(
	ctx context.Context, typ, ownerID string, write func(o *repo.Repo) error,
) error {
	return pgstore.InTx(ctx, f.owners.Pool(), func(tx pgstore.Tx) error {
		if err := write(f.owners.With(tx)); err != nil {
			return err
		}
		return f.rec.With(tx).Record(ctx, ownerID, typ, "owner/"+ownerID, nil)
	})
}
