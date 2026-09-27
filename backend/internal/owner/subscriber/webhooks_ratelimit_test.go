package subscriber_test

// Saturation: the receiver rate-limits (docs/design/event-bus-outbox-webhooks.md, *Test plan* ›
// "Saturation and degradation UTs", *Retry* › "Do not hammer a dead endpoint"). Real River
// workers, real Postgres, httptest receivers that count every request.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/subscriber"
)

const (
	// limitedAnswers —— the receiver answers 429 (Retry-After: 1) this many times, then 204.
	limitedAnswers = 3
	// tightAttempts —— fewer attempts than 429s: a snooze that spent an attempt would discard.
	tightAttempts = 2
	rigPoll       = 20 * time.Millisecond
	rigGrace      = time.Second
	clientTimeout = 5 * time.Second
	jobDeadline   = 20 * time.Second
)

// countingSink —— a receiver that counts requests; answer decides the reply to the nth (from 1).
type countingSink struct {
	*httptest.Server

	hits atomic.Int32
}

func newSink(t *testing.T, answer func(n int32, w http.ResponseWriter)) *countingSink {
	t.Helper()
	s := &countingSink{}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		answer(s.hits.Add(1), w)
	}))
	t.Cleanup(s.Close)
	return s
}

func rateLimitedFirst(n int32, w http.ResponseWriter) {
	if n <= limitedAnswers {
		w.Header().Set("Retry-After", strconv.Itoa(1))
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func alwaysOK(_ int32, w http.ResponseWriter) { w.WriteHeader(http.StatusNoContent) }

// runningDelivery —— webhook.deliver on started River workers, with a client that may reach
// loopback, and at most `attempts` attempts per job.
//
//nolint:ireturn // the port is what the test reads jobs through
func runningDelivery(t *testing.T, fx fixture, attempts int) (*subscriber.Deps, jobs.Runtime) {
	t.Helper()
	var rt jobs.Runtime
	d := subscriber.NewDeps(&subscriber.Deps{
		Repo: fx.r, Pool: fx.pool, Embeds: projectsOnly,
		Secrets: func(context.Context, string) (string, error) { return events.NewWebhookSecret() },
		Jobs:    func() jobs.Jobs { return rt },
		Event: func(context.Context, string) (events.Event, error) {
			return *ev(note, "wiki://a", `{"published":true}`), nil
		},
	})
	d.SetClient(&http.Client{Timeout: clientTimeout})
	kinds := subscriber.Kinds(d)
	kinds[0].MaxAttempts = attempts
	ctx := context.Background()
	if err := jobsriver.Migrate(ctx, fx.pool); err != nil {
		t.Fatal(err)
	}
	var err error
	opts := jobsriver.Options{FetchPollInterval: rigPoll, StopGrace: rigGrace}
	if rt, err = jobsriver.New(fx.pool, kinds, nil, opts); err != nil {
		t.Fatal(err)
	}
	if err = rt.Start(ctx); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if serr := rt.Stop(context.Background()); serr != nil {
			t.Errorf("stop jobs: %v", serr)
		}
	})
	return d, rt
}

// until —— polls cond until it holds; fails with what when the deadline passes first.
func until(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(jobDeadline)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(rigPoll)
	}
}

func stateOf(t *testing.T, rt jobs.Runtime, id jobs.JobID) jobs.State {
	t.Helper()
	j, err := rt.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return j.State
}

// deferredDelivery —— the fanned-out event's one delivery to endpointID, which must still wait out
// the cooldown.
func deferredDelivery(t *testing.T, rt jobs.Runtime, endpointID string) {
	t.Helper()
	args, err := json.Marshal(entity.DeliverArgs{EndpointID: endpointID, EventID: "e1"})
	if err != nil {
		t.Fatal(err)
	}
	got, err := rt.List(context.Background(),
		jobs.Filter{Kind: entity.WebhookDeliverKind, Args: args})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || !waitsOutTheCooldown(&got[0]) {
		t.Fatalf("deliveries to the cooling endpoint: %+v, want one waiting out the cooldown", got)
	}
}

func waitsOutTheCooldown(j *jobs.Job) bool {
	return j.State == jobs.StatePending &&
		time.Until(j.ScheduledAt) >= subscriber.Cooldown-time.Minute
}

// TestRepeated429sNeverDiscardAndACoolingEndpointGetsNoExtraRequests — a receiver answers 429 with
// Retry-After three times. The delivery snoozes each time without spending an attempt, so with
// only two attempts it still completes (never discarded). Meanwhile a new event fans out: the
// rate-limited endpoint's delivery waits out the cooldown, so it sends no extra request, while a
// healthy endpoint gets its delivery at once (the queue is running).
func TestRepeated429sNeverDiscardAndACoolingEndpointGetsNoExtraRequests(t *testing.T) {
	t.Setenv(testSecretEnv, testInstanceSecret)
	fx := setup(t)
	limited, healthy := newSink(t, rateLimitedFirst), newSink(t, alwaysOK)
	a := create(t, fx.r, fx.owner, limited.URL)
	b := create(t, fx.r, fx.owner, healthy.URL)
	d, rt := runningDelivery(t, fx, tightAttempts)
	first, err := rt.Enqueue(context.Background(), entity.WebhookDeliverKind,
		entity.DeliverArgs{EndpointID: a.ID, EventID: "e0"}, jobs.EnqueueOpts{})
	if err != nil {
		t.Fatal(err)
	}
	until(t, "the first 429 to start the failure streak", func() bool {
		return get(t, fx.r, fx.owner, a.ID).FailingSince != nil
	})
	fanOut(t, d, fx.owner)
	until(t, "the rate-limited delivery to complete", func() bool {
		st := stateOf(t, rt, first)
		if st == jobs.StateDiscarded {
			t.Fatal("repeated 429s exhausted the delivery into discarded")
		}
		return st == jobs.StateCompleted
	})
	until(t, "the healthy endpoint's delivery", func() bool { return healthy.hits.Load() == 1 })
	if got := limited.hits.Load(); got != limitedAnswers+1 {
		t.Fatalf("the rate-limited endpoint got %d requests, want %d (the snoozed retries only)",
			got, limitedAnswers+1)
	}
	deferredDelivery(t, rt, a.ID)
	if n := len(deliveriesOf(t, rt, b.ID)); n != 1 {
		t.Fatalf("healthy endpoint: %d deliveries, want 1", n)
	}
}
