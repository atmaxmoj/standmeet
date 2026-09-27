package wire

// The registry-driven idempotency test (docs/design/event-bus-outbox-webhooks.md, *Enforcement* ›
// runtime and test backstops): delivery is at-least-once, so every subscription the server
// registers must reach the same observable state whether an event is handled once or twice.
//
// The table is the registry itself (collectSubscriptions), not a hand list: a new subscription
// is covered the moment it is registered, and one without a driver below FAILS this test.

import (
	"context"
	"encoding/json"
	"strconv"
	"testing"
	"time"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpussub "github.com/atmaxmoj/standmeet/internal/corpus/subscriber"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

const (
	instanceSecretEnv = "INSTANCE_SECRET"
	// testInstanceSecret —— a test fixture, not a real secret.
	testInstanceSecret = "test-instance-secret-at-least-32-bytes-long" //gitleaks:allow
	bookingStart       = "2030-03-04T14:00:00Z"
)

// idemCase —— one event to deliver twice, and what its effect looks like from outside.
type idemCase struct {
	observe func() string
	label   string
	eventID string
}

// driver —— builds the rows a subscription needs and the events that exercise it.
type driver func(t *testing.T, h *idem) []idemCase

// drivers —— one per registered subscription. Adding a subscription means adding its driver
// here; the test fails until then.
var drivers = map[string]driver{ //nolint:gochecknoglobals // the test's table
	corpussub.IndexSubscriber:            driveIndex,
	entity.WebhookFanout:                 driveWebhookFanout,
	entity.OwnerNotify:                   driveOwnerNotify,
	subscriber.HomepagePublishSubscriber: driveHomepagePublish,
	subscriber.AssetRefsSubscriber:       driveAssetRefs,
}

func TestEveryRegisteredSubscriptionIsIdempotent(t *testing.T) {
	t.Setenv(instanceSecretEnv, testInstanceSecret) // webhook secrets are sealed with it
	h := newIdem(t)
	if len(h.subs) == 0 {
		t.Fatal("the registry is empty: the harness no longer supplies what the subscriptions need")
	}
	for _, s := range h.subs {
		drive, ok := drivers[s.Name]
		if !ok {
			t.Errorf("subscription %q has no idempotency driver: register one in drivers "+
				"(cmd/server/wire/idempotency_test.go) that delivers an event it handles and "+
				"observes its effect", s.Name)
			continue
		}
		for _, c := range drive(t, h) {
			h.deliverTwice(t, s.Name, &c)
		}
	}
}

// deliverTwice —— the first delivery must change what is observed; the second must not.
func (h *idem) deliverTwice(t *testing.T, sub string, c *idemCase) {
	t.Helper()
	before := c.observe()
	h.deliver(t, sub, c.eventID)
	once := c.observe()
	if once == before {
		t.Errorf("%s (%s): the first delivery had no observable effect (%s); the driver must "+
			"exercise the subscription", sub, c.label, once)
		return
	}
	h.deliver(t, sub, c.eventID)
	if twice := c.observe(); twice != once {
		t.Errorf("%s (%s): delivered twice → %s, once → %s: not idempotent",
			sub, c.label, twice, once)
	}
}

// ref —— a row the driver made, and the event about it.
type ref struct{ id, event string }

// note —— a published wiki note of the owner; the trigger records its corpus.note.changed event.
func (h *idem) note(t *testing.T, title string) ref {
	t.Helper()
	var id string
	if err := h.d.DB.QueryRow(context.Background(), `INSERT INTO corpus_notes
		(owner_id, genre, title, body, slug, published) VALUES ($1, 'wiki', $2, 'b', $2, true)
		RETURNING id`, h.owner, title).Scan(&id); err != nil {
		t.Fatalf("insert note: %v", err)
	}
	return ref{id: id, event: h.latest(t, corpussub.NoteChanged, "note_id", id)}
}

func driveIndex(t *testing.T, h *idem) []idemCase {
	t.Helper()
	n := h.note(t, "indexed")
	return []idemCase{{label: "note created", eventID: n.event, observe: func() string {
		return strconv.FormatBool(h.index.has(n.id))
	}}}
}

// driveWebhookFanout —— the effect is the deliveries queued for the endpoint (each one POSTs).
func driveWebhookFanout(t *testing.T, h *idem) []idemCase {
	t.Helper()
	secret, err := events.NewWebhookSecret()
	if err != nil {
		t.Fatal(err)
	}
	ep, err := h.d.OwnerRepo.CreateWebhook(context.Background(), h.owner, &entity.WebhookEndpoint{
		URL: "https://example.com/hook", EventTypes: []string{corpussub.NoteChanged},
	}, secret)
	if err != nil {
		t.Fatal(err)
	}
	ev := h.note(t, "hooked").event
	return []idemCase{{label: "published note to an endpoint", eventID: ev, observe: func() string {
		return strconv.Itoa(h.deliveries(t, ep.ID, ev))
	}}}
}

// deliveries —— webhook.deliver jobs queued for (endpoint, event).
func (h *idem) deliveries(t *testing.T, endpointID, eventID string) int {
	t.Helper()
	args, err := json.Marshal(entity.DeliverArgs{EndpointID: endpointID, EventID: eventID})
	if err != nil {
		t.Fatal(err)
	}
	got, err := h.d.Jobs.List(context.Background(),
		jobs.Filter{Kind: entity.WebhookDeliverKind, Args: args})
	if err != nil {
		t.Fatal(err)
	}
	return len(got)
}

// driveOwnerNotify —— the effect is mail: sends carrying the event's Message-ID.
func driveOwnerNotify(t *testing.T, h *idem) []idemCase {
	t.Helper()
	ctx := context.Background()
	req, err := h.d.AccessRequestRepo.Create(ctx, &access.CreateAccessRequestInput{
		OwnerID: h.owner, Name: "V", Email: "visitor@example.com", Message: "may I?",
	})
	if err != nil {
		t.Fatal(err)
	}
	reqEv := h.record(t, access.AccessRequestCreated, "access_request/"+req.ID, "request_id",
		map[string]string{"request_id": req.ID})
	bookingEv := h.record(t, usecase.BookingCreated, "booking/bk-1", "booking_id",
		map[string]string{"booking_id": h.booking(t, "bk-1")})
	sends := func(ev string) func() string {
		return func() string { return strconv.Itoa(h.mail.withMessageID("<" + ev + "@standmeet>")) }
	}
	return []idemCase{
		{label: "access request", eventID: reqEv, observe: sends(reqEv)},
		{label: "booking", eventID: bookingEv, observe: sends(bookingEv)},
	}
}

// booking —— a booking whose role asked for the owner's notice (as booking.record leaves it).
func (h *idem) booking(t *testing.T, id string) string {
	t.Helper()
	start, err := time.Parse(time.RFC3339, bookingStart)
	if err != nil {
		t.Fatal(err)
	}
	n := &repo.BookingNotice{
		OwnerID: h.owner, BookingID: id, Summary: "Intro call", VisitorName: "Dana", StartAt: start,
	}
	if err = h.d.OwnerRepo.RecordBooking(context.Background(), n,
		func(pgstore.Tx) error { return nil }); err != nil {
		t.Fatal(err)
	}
	return id
}

// built —— a page with one build of source, settled built; the page and its settled event.
func (h *idem) built(t *testing.T, slug, source string) ref {
	t.Helper()
	ctx := context.Background()
	p, err := h.d.MicrositeRepo.Create(ctx, h.owner, slug, slug)
	if err != nil {
		t.Fatal(err)
	}
	b, err := h.d.MicrositeBuildRepo.Create(ctx, p.ID, map[string]string{"App.tsx": source})
	if err == nil {
		_, err = h.d.MicrositeBuildRepo.MarkBuilt(ctx, b.ID, "out/"+b.ID)
	}
	if err != nil {
		t.Fatal(err)
	}
	return ref{id: p.ID, event: h.record(t, usecase.MicrositeBuildSettled, "microsite/"+p.ID,
		"build_id", map[string]string{"build_id": b.ID, "status": usecase.BuildBuilt})}
}

func driveHomepagePublish(t *testing.T, h *idem) []idemCase {
	t.Helper()
	page := h.built(t, usecase.HomepageSlug, "home v1")
	return []idemCase{{label: "home page built", eventID: page.event, observe: func() string {
		p, err := h.d.MicrositeRepo.GetByID(context.Background(), page.id)
		if err != nil || p.LiveBuildID == nil {
			return "not live"
		}
		return "live " + *p.LiveBuildID
	}}}
}

func driveAssetRefs(t *testing.T, h *idem) []idemCase {
	t.Helper()
	var asset string
	if err := h.d.DB.QueryRow(context.Background(), `INSERT INTO assets (owner_id, storage_key)
		VALUES ($1, 'k') RETURNING id`, h.owner).Scan(&asset); err != nil {
		t.Fatal(err)
	}
	page := h.built(t, "gallery", `<img src="standmeet-asset:`+asset+`">`)
	return []idemCase{{label: "page embeds an asset", eventID: page.event, observe: func() string {
		var n int
		if err := h.d.DB.QueryRow(context.Background(), `SELECT count(*) FROM asset_references
			WHERE referrer_id = $1`, page.id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return strconv.Itoa(n) + " references"
	}}}
}
