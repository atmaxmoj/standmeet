package wire

// The harness of the registry-driven idempotency test (idempotency_test.go): the production
// composition (collectEventTypes → collectSubscriptions → events.New) over a scratch Postgres,
// with recording stand-ins only at our own ports — the corpus Indexer and the mail seam's
// supplier — and a miniredis behind the mail throttle.

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/cmd/server/deps"
	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/plugin/adapters"
)

// recordingIndex —— the corpus Indexer port: the index as a set of note ids (an upsert per id).
type recordingIndex struct {
	docs map[string]bool
	mu   sync.Mutex
}

func (x *recordingIndex) IndexNote(_ context.Context, _, noteID string) error {
	return x.put(noteID, true)
}

func (x *recordingIndex) IndexSubtree(_ context.Context, _, noteID string) error {
	return x.put(noteID, true)
}

func (x *recordingIndex) DeleteNote(_ context.Context, noteID string) error {
	return x.put(noteID, false)
}

func (*recordingIndex) ReindexOwner(context.Context, string) error { return nil }

func (x *recordingIndex) put(id string, in bool) error {
	x.mu.Lock()
	defer x.mu.Unlock()
	x.docs[id] = in
	return nil
}

func (x *recordingIndex) has(id string) bool {
	x.mu.Lock()
	defer x.mu.Unlock()
	return x.docs[id]
}

// recordingMail —— the mail seam's supplier: connected, and records every message it sends.
type recordingMail struct {
	sent []adapters.MailMessage
	mu   sync.Mutex
}

func (*recordingMail) Name() string                                    { return "recording-mail" }
func (*recordingMail) Kind() string                                    { return "protocol" }
func (*recordingMail) Connected(context.Context, string) (bool, error) { return true, nil }

func (m *recordingMail) Send(
	_ context.Context, _ string, msg *adapters.MailMessage,
) (adapters.MailReceipt, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sent = append(m.sent, *msg)
	return adapters.MailReceipt{}, nil
}

// withMessageID —— how many sends carried this Message-ID.
func (m *recordingMail) withMessageID(id string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for i := range m.sent {
		if m.sent[i].MessageID == id {
			n++
		}
	}
	return n
}

// idem —— the composed runtime the drivers act on.
type idem struct {
	d     *deps.Runtime
	index *recordingIndex
	mail  *recordingMail
	kinds map[string]jobs.Kind
	owner string
	subs  []events.Subscription
}

func newIdem(t *testing.T) *idem {
	t.Helper()
	pool := scratchDB(t)
	h := &idem{index: &recordingIndex{docs: map[string]bool{}}, mail: &recordingMail{}}
	lookup := func(context.Context, string, string) (adapters.Supplier, error) {
		return h.mail, nil
	}
	h.d = &deps.Runtime{
		DB: pool, Log: slog.New(slog.DiscardHandler), CorpusIndexer: h.index,
		BlockDispatch: adapters.NewDispatcher(lookup),
		RDB:           redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()}),
		OwnerRepo:     owner.NewRepo(pool), MicrositeRepo: owner.NewMicrositeRepo(pool),
		MicrositeBuildRepo: owner.NewMicrositeBuildRepo(pool),
		AssetRepo:          corpus.NewAssetRepo(pool, ""),
		AccessRequestRepo:  access.NewAccessRequestRepo(pool), CodeRepo: access.NewCodeRepo(pool),
		EmbedRepo: access.NewEmbedRepo(pool), CodeDenialRepo: access.NewCodeDenialRepo(pool),
		RoleRepo: access.NewRoleRepo(pool),
		WebhookSecrets: func(context.Context, string) (string, error) {
			return events.NewWebhookSecret()
		},
	}
	h.compose(t)
	h.owner = h.seedOwner(t)
	return h
}

// compose —— the bus exactly as BuildBackground builds it, and a (not started) River runtime
// that holds what the handlers enqueue.
func (h *idem) compose(t *testing.T) {
	t.Helper()
	types := collectEventTypes(h.d)
	hooks := webhookDeliveryDeps(h.d)
	h.subs = collectSubscriptions(h.d, hooks, types)
	bus, err := events.New(h.d.DB, types, h.subs)
	if err != nil {
		t.Fatal(err)
	}
	h.d.Events = bus
	h.kinds = map[string]jobs.Kind{}
	for _, k := range bus.Kinds() {
		h.kinds[k.Name] = k
	}
	if err = jobsriver.Migrate(context.Background(), h.d.DB); err != nil {
		t.Fatal(err)
	}
	all := append(bus.Kinds(), owner.WebhookJobKinds(hooks)...)
	if h.d.Jobs, err = jobsriver.New(h.d.DB, all, nil, jobsriver.Options{}); err != nil {
		t.Fatal(err)
	}
}

func (h *idem) seedOwner(t *testing.T) string {
	t.Helper()
	var id string
	if err := h.d.DB.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name, public_url)
		VALUES ('owner@example.com', 'x', 'o', 'O', 'https://o.example') RETURNING id`,
	).Scan(&id); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	return id
}

// record —— one event of the owner; its id, found by data[key].
func (h *idem) record(t *testing.T, typ, subject, key string, data map[string]string) string {
	t.Helper()
	err := h.d.Events.Recorder().Record(context.Background(), h.owner, typ, subject, data)
	if err != nil {
		t.Fatalf("record %s: %v", typ, err)
	}
	return h.latest(t, typ, key, data[key])
}

// latest —— the newest event of typ whose data[key] is value.
func (h *idem) latest(t *testing.T, typ, key, value string) string {
	t.Helper()
	id, err := h.d.Events.LatestFor(context.Background(), typ, key, value)
	if err != nil || id == "" {
		t.Fatalf("no %s event with %s=%s (%v)", typ, key, value, err)
	}
	return id
}

// deliver —— one run of the subscription's job handler on the event, as a worker runs it.
func (h *idem) deliver(t *testing.T, sub, eventID string) {
	t.Helper()
	raw, err := json.Marshal(events.JobArgs{EventID: eventID})
	if err != nil {
		t.Fatal(err)
	}
	if err = h.kinds[sub].Handle(context.Background(), raw); err != nil {
		t.Fatalf("%s on event %s: %v", sub, eventID, err)
	}
}
