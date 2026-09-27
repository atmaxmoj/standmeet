package subscriber_test

// The DB-backed tests seal endpoint secrets, so they set INSTANCE_SECRET; t.Setenv forbids
// t.Parallel.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
)

const (
	note          = "corpus.note.changed"
	testSecretEnv = "INSTANCE_SECRET"
	// testInstanceSecret — a test fixture, not a real secret.
	testInstanceSecret = "test-instance-secret-at-least-32-bytes-long" //gitleaks:allow
	deadReason         = "dead"
	missingID          = "00000000-0000-0000-0000-000000000000"
)

func ep(id string, types ...string) entity.WebhookEndpoint {
	return entity.WebhookEndpoint{ID: id, EventTypes: types, Enabled: true}
}

func ev(typ, subject, data string) *events.Event {
	return &events.Event{
		ID: "e1", OwnerID: "o", Type: typ, Subject: subject, Data: json.RawMessage(data),
	}
}

// noteEv — a corpus note change with the two publish flags.
func noteEv(subject string, published, wasPublished bool) *events.Event {
	return ev(note, subject, `{"published":`+strconv.FormatBool(published)+
		`,"was_published":`+strconv.FormatBool(wasPublished)+`}`)
}

func ids(eps []entity.WebhookEndpoint) string {
	out := make([]string, 0, len(eps))
	for i := range eps {
		out = append(out, eps[i].ID)
	}
	return strings.Join(out, ",")
}

func TestTargetsApplyTheTypeGlobsAndThePublishedSliceScope(t *testing.T) {
	t.Parallel()
	eps := []entity.WebhookEndpoint{
		ep("exact", note), ep("glob", "corpus.*"), ep("test", "webhook.test"),
	}
	const both, none = "exact,glob", ""
	cases := []struct {
		ev   *events.Event
		name string
		want string
	}{
		{name: "published edit", ev: noteEv("wiki://a", true, true), want: both},
		{name: "publish", ev: noteEv("wiki://a", true, false), want: both},
		{name: "unpublish is heard", ev: noteEv("wiki://a", false, true), want: both},
		{name: "never published", ev: noteEv("wiki://a", false, false), want: none},
		{name: "raw never leaves", ev: noteEv("raw://1", true, true), want: none},
		{
			name: "test: its own endpoint only", want: "glob",
			ev: ev("webhook.test", "webhook://glob", `{"endpoint_id":"glob"}`),
		},
	}
	for _, c := range cases {
		got, err := subscriber.Targets(context.Background(), eps, c.ev, nil)
		if err != nil || ids(got) != c.want {
			t.Errorf("%s: targets %q (%v), want %q", c.name, ids(got), err, c.want)
		}
	}
}

// — DB-backed —

// fixture — a scratch database with one owner.
type fixture struct {
	pool  *pgxpool.Pool
	r     *repo.Repo
	owner string
}

func setup(t *testing.T) fixture {
	t.Helper()
	pool := scratchDB(t)
	var owner string
	if err := pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name) VALUES ('o@example.com', 'x', 'o', 'O')
		RETURNING id`).Scan(&owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	return fixture{pool: pool, r: repo.NewRepo(pool), owner: owner}
}

func create(t *testing.T, r *repo.Repo, owner, url string) entity.WebhookEndpoint {
	t.Helper()
	secret, err := events.NewWebhookSecret()
	if err != nil {
		t.Fatal(err)
	}
	e, err := r.CreateWebhook(context.Background(), owner,
		&entity.WebhookEndpoint{URL: url, EventTypes: []string{note}}, secret)
	if err != nil {
		t.Fatalf("create endpoint: %v", err)
	}
	return e
}

func get(t *testing.T, r *repo.Repo, owner, id string) entity.WebhookEndpoint {
	t.Helper()
	e, err := r.GetWebhook(context.Background(), owner, id)
	if err != nil {
		t.Fatalf("get endpoint: %v", err)
	}
	return e
}

func fail(t *testing.T, r *repo.Repo, id string) {
	t.Helper()
	ctx := context.Background()
	if err := r.WebhookFailed(ctx, id, subscriber.DisableAfter, deadReason); err != nil {
		t.Fatal(err)
	}
}

func leaseErr(r *repo.Repo, id string) error {
	_, err := r.LeaseWebhook(context.Background(), id, time.Minute)
	return err
}

func TestTheLeaseAdmitsOneDeliveryPerEndpoint(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	fx := setup(t)
	r, owner := fx.r, fx.owner
	e := create(t, r, owner, "https://example.com/hook")
	if err := leaseErr(r, e.ID); err != nil {
		t.Fatalf("first lease: %v", err)
	}
	if err := leaseErr(r, e.ID); !errors.Is(err, entity.ErrWebhookBusy) {
		t.Fatalf("second lease while the first is held: %v, want busy", err)
	}
	if err := r.WebhookSucceeded(context.Background(), e.ID); err != nil {
		t.Fatal(err)
	}
	if err := leaseErr(r, e.ID); err != nil {
		t.Fatalf("settling did not release the lease: %v", err)
	}
}

// ageStreak — backdates the endpoint's failure streak by 6 days.
func ageStreak(t *testing.T, pool *pgxpool.Pool, id string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE webhook_endpoints
		SET failing_since = now() - interval '6 days' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
}

func TestAFailureStreakOlderThanFiveDaysDisablesTheEndpoint(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	fx := setup(t)
	pool, r, owner := fx.pool, fx.r, fx.owner
	e := create(t, r, owner, "https://example.com/hook")
	fail(t, r, e.ID)
	if got := get(t, r, owner, e.ID); got.FailingSince == nil || !got.Enabled {
		t.Fatalf("after one failure: %+v, want a streak on an enabled endpoint", got)
	}
	ageStreak(t, pool, e.ID)
	fail(t, r, e.ID)
	if got := get(t, r, owner, e.ID); got.Enabled || got.DisabledReason != deadReason {
		t.Fatalf("after 6 days of failures: %+v, want disabled with the reason", got)
	}
}

func TestTurningAnEndpointBackOnClearsItsStreak(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	fx := setup(t)
	r, owner := fx.r, fx.owner
	e := create(t, r, owner, "https://example.com/hook")
	fail(t, r, e.ID)
	on := true
	patch := entity.WebhookPatch{Enabled: &on}
	got, err := r.UpdateWebhook(context.Background(), owner, e.ID, &patch)
	if err != nil || !got.Enabled || got.DisabledReason != "" || got.FailingSince != nil {
		t.Fatalf("re-enabled: %+v (%v), want the streak and reason cleared", got, err)
	}
}

// harness — the delivery deps over a River runtime that is built but not started, so enqueued
// jobs stay put for the assertions.
//
//nolint:ireturn // the port is what the tests read jobs through
func harness(t *testing.T, pool *pgxpool.Pool, r *repo.Repo) (*subscriber.Deps, jobs.Runtime) {
	t.Helper()
	var rt jobs.Runtime
	d := subscriber.NewDeps(&subscriber.Deps{
		Repo: r, Pool: pool, Embeds: projectsOnly,
		Secrets: func(context.Context, string) (string, error) { return events.NewWebhookSecret() },
		Jobs:    func() jobs.Jobs { return rt },
		Event: func(context.Context, string) (events.Event, error) {
			return *ev(note, "wiki://a", `{"published":true}`), nil
		},
	})
	if err := jobsriver.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	var err error
	if rt, err = jobsriver.New(pool, subscriber.Kinds(d), nil, jobsriver.Options{}); err != nil {
		t.Fatal(err)
	}
	return d, rt
}

func deliveriesOf(t *testing.T, rt jobs.Runtime, endpointID string) []jobs.Job {
	t.Helper()
	args, err := json.Marshal(map[string]string{"endpoint_id": endpointID})
	if err != nil {
		t.Fatal(err)
	}
	got, err := rt.List(context.Background(),
		jobs.Filter{Kind: entity.WebhookDeliverKind, Args: args})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// fanOut — runs the webhook.fanout subscription on one published note change of owner.
func fanOut(t *testing.T, d *subscriber.Deps, owner string) {
	t.Helper()
	fan := subscriber.Subscriptions(d, []events.Type{{Type: note, Exposure: events.Webhook}})[0]
	e := ev(note, "wiki://a", `{"published":true,"was_published":true}`)
	e.OwnerID = owner
	if err := fan.Handle(context.Background(), *e); err != nil {
		t.Fatalf("fan out: %v", err)
	}
}

func TestFanOutEnqueuesOneDeliveryPerEnabledTarget(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	fx := setup(t)
	pool, r, owner := fx.pool, fx.r, fx.owner
	healthy := create(t, r, owner, "https://example.com/a")
	off := create(t, r, owner, "https://example.com/c")
	disable := false
	if _, err := r.UpdateWebhook(context.Background(), owner, off.ID,
		&entity.WebhookPatch{Enabled: &disable}); err != nil {
		t.Fatal(err)
	}
	d, rt := harness(t, pool, r)
	fanOut(t, d, owner)
	if n := len(deliveriesOf(t, rt, healthy.ID)); n != 1 {
		t.Fatalf("enabled endpoint: %d deliveries, want 1", n)
	}
	if n := len(deliveriesOf(t, rt, off.ID)); n != 0 {
		t.Fatalf("disabled endpoint: %d deliveries, want none", n)
	}
}

func TestFanOutDefersAFailingEndpointPastTheCooldown(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	fx := setup(t)
	pool, r, owner := fx.pool, fx.r, fx.owner
	failing := create(t, r, owner, "https://example.com/b")
	fail(t, r, failing.ID)
	d, rt := harness(t, pool, r)
	fanOut(t, d, owner)
	late := deliveriesOf(t, rt, failing.ID)
	if len(late) != 1 || time.Until(late[0].ScheduledAt) < subscriber.Cooldown-time.Minute {
		t.Fatalf("failing endpoint: %+v, want one delivery scheduled after the cooldown", late)
	}
}

func deliverArgs(t *testing.T, id string) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(entity.DeliverArgs{EndpointID: id, EventID: "e1"})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestDeliverySnoozesWhileTheEndpointIsBusyAndDiscardsWhenItIsGone(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	fx := setup(t)
	pool, r, owner := fx.pool, fx.r, fx.owner
	e := create(t, r, owner, "https://example.com/a")
	d, _ := harness(t, pool, r)
	handle := subscriber.Kinds(d)[0].Handle
	if err := leaseErr(r, e.ID); err != nil {
		t.Fatalf("could not take the lease: %v", err)
	}
	if _, snoozed := jobs.SnoozeOf(handle(context.Background(), deliverArgs(t, e.ID))); !snoozed {
		t.Error("a busy endpoint must snooze the delivery")
	}
	if err := handle(context.Background(), deliverArgs(t, missingID)); !jobs.IsDiscard(err) {
		t.Errorf("a deleted endpoint: %v, want discard", err)
	}
}

func TestADeliveryToAPrivateAddressIsDiscardedAndStartsTheStreak(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	fx := setup(t)
	pool, r, owner := fx.pool, fx.r, fx.owner
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	e := create(t, r, owner, srv.URL)
	d, _ := harness(t, pool, r)
	err := subscriber.Kinds(d)[0].Handle(context.Background(), deliverArgs(t, e.ID))
	if !jobs.IsDiscard(err) || !errors.Is(err, httpx.ErrBlockedEgress) {
		t.Fatalf("loopback target: %v, want a discard for the SSRF guard", err)
	}
	if got := get(t, r, owner, e.ID); got.FailingSince == nil {
		t.Error("a failed delivery must start the failure streak")
	}
	if err = leaseErr(r, e.ID); err != nil {
		t.Errorf("the lease must be released after the attempt: %v", err)
	}
}
