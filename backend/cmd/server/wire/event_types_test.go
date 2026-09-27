package wire

// Every event type the bus is built with, checked as data
// (docs/design/event-bus-outbox-webhooks.md, *Model › Event*): declared once, a dotted
// noun-then-verb name, a description, a documented subject pattern, and an exposure chosen on
// purpose — the zero value (Internal) is only legal for the types listed here as internal. The
// inventory's webhook types must all be declared, and exposed.

import (
	"regexp"
	"testing"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

// internalTypes —— the types that deliberately never leave the instance.
var internalTypes = map[string]bool{}

// inventoryWebhookTypes —— *Consolidation inventory › Webhook event types*, plus the two built
// before it (corpus.note.changed, webhook.test).
var inventoryWebhookTypes = []string{
	"access_request.created", "access_request.approved", "access_request.status_changed",
	"code.issued", "code.revoked", "code.redeemed",
	"conversation.started", "conversation.message", "conversation.pruned", "ghost.accepted",
	"booking.created", "booking.cancelled", "booking.rescheduled",
	"application.committed", "jobs.fetched",
	"writing.published", "writing.unpublished", "corpus.note.changed", "vault.imported",
	"microsite.build.settled", "page.promoted_live", "page.rolled_back", "page.unpublished",
	"microsite.store.doc_inserted",
	"api_key.issued", "api_key.revoked",
	"supplier.connected", "supplier.disconnected", "supplier.activated",
	"block.installed", "block.failed",
	"gas.exhausted", "gas.refilled", "instance.upgrade_requested",
	"owner.login", "owner.email_changed", "owner.recovery_requested", "ip_ban.added",
	"webhook.test",
}

var (
	typeName = regexp.MustCompile(`^[a-z_]+(\.[a-z_]+)+$`)
	// <noun>/<what the id is>, or a URI: <scheme>://<what the rest is>.
	subjectPattern = regexp.MustCompile(`^([a-z_]+/|(<[a-z ]+>|[a-z_]+)://)<[a-z ]+>$`)
)

func TestEventTypes_declaredOnceAsDocumentedData(t *testing.T) {
	t.Parallel()
	seen := map[string]events.Type{}
	for _, ty := range collectEventTypes(&deps.Runtime{}) {
		if _, dup := seen[ty.Type]; dup {
			t.Errorf("%s declared twice", ty.Type)
		}
		seen[ty.Type] = ty
		checkNaming(t, &ty)
		checkExposure(t, &ty)
	}
	for _, name := range inventoryWebhookTypes {
		if seen[name].Exposure != events.Webhook {
			t.Errorf("%s (inventory) is not declared as a webhook type", name)
		}
	}
}

func checkNaming(t *testing.T, ty *events.Type) {
	t.Helper()
	if !typeName.MatchString(ty.Type) {
		t.Errorf("%q: the name must be a dotted noun then verb", ty.Type)
	}
	if ty.Description == "" {
		t.Errorf("%s: no description", ty.Type)
	}
	if !subjectPattern.MatchString(ty.Subject) {
		t.Errorf("%s: subject pattern %q is not <noun>/<what the id is>", ty.Type, ty.Subject)
	}
}

func checkExposure(t *testing.T, ty *events.Type) {
	t.Helper()
	if ty.Exposure == events.Internal && !internalTypes[ty.Type] {
		t.Errorf("%s: exposure left at the zero value (Internal) without being listed internal",
			ty.Type)
	}
}
