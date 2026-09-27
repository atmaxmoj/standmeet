package events_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

const (
	typNoteChanged = "corpus.note.changed"
	typRequest     = "access_request.created"
	subIndex       = "corpus.index"
	subTimeout     = 5 * time.Second
	rigFetchPoll   = 20 * time.Millisecond
)

var noteChanged = events.Type{
	Type: typNoteChanged, Description: "a corpus note changed", Subject: "the note's URI",
}

// errAbort — the error a test transaction returns to force its rollback.
var errAbort = errors.New("abort")

func nop(context.Context, events.Event) error { return nil }

func sub(name string, globs ...string) events.Subscription {
	return events.Subscription{
		Name: name, Types: globs, Queue: jobs.QueueIndex, MaxAttempts: 3, Timeout: subTimeout,
		Handle: nop,
	}
}

// indexSub — the one-subscriber setup most relay tests use.
func indexSub() []events.Subscription {
	return []events.Subscription{sub(subIndex, "corpus.note.*")}
}

// rig — a scratch database, a bus, and a River runtime that is NOT started: jobs are inserted
// (so fan-out is observable as river_job rows) but never run, unless a test starts it.
type rig struct {
	pool *pgxpool.Pool
	bus  *events.Bus
	jobs jobs.Runtime
}

func newRig(t *testing.T, types []events.Type, subs []events.Subscription) *rig {
	t.Helper()
	pool := scratchDB(t)
	bus, err := events.New(pool, types, subs)
	if err != nil {
		t.Fatalf("events.New: %v", err)
	}
	if err = jobsriver.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	opts := jobsriver.Options{FetchPollInterval: rigFetchPoll, StopGrace: time.Second}
	rt, err := jobsriver.New(pool, bus.Kinds(), nil, opts)
	if err != nil {
		t.Fatal(err)
	}
	return &rig{pool: pool, bus: bus, jobs: rt}
}

// record — one event in its own transaction; a nil data map records no data.
func (r *rig) record(t *testing.T, typ, subject string, data map[string]string) {
	t.Helper()
	rec := r.bus.Recorder()
	ctx := context.Background()
	var err error
	if data == nil {
		err = rec.Record(ctx, "", typ, subject, nil)
	} else {
		err = rec.Record(ctx, "", typ, subject, data)
	}
	if err != nil {
		t.Fatalf("record: %v", err)
	}
}

func (r *rig) fanOut(t *testing.T) int {
	t.Helper()
	n, err := r.bus.FanOut(context.Background(), r.jobs)
	if err != nil {
		t.Fatalf("fan out: %v", err)
	}
	return n
}

func (r *rig) jobCount(t *testing.T, kind string) int {
	t.Helper()
	var n int
	q := `SELECT count(*) FROM river_job WHERE kind = $1`
	if err := r.pool.QueryRow(context.Background(), q, kind).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (r *rig) backlog(t *testing.T) events.Backlog {
	t.Helper()
	b, err := r.bus.Backlog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func (r *rig) unfanned(t *testing.T) int {
	t.Helper()
	return r.backlog(t).Unfanned
}

func (r *rig) list(t *testing.T) []events.Event {
	t.Helper()
	evs, err := r.bus.List(context.Background(), events.Filter{})
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	return evs
}

// — Recorder —

// recordAndAbort — records inside a transaction that then rolls back.
func recordAndAbort(t *testing.T, r *rig, subject string) {
	t.Helper()
	ctx := context.Background()
	err := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		rec := r.bus.Recorder().With(tx)
		if rerr := rec.Record(ctx, "", typRequest, subject, nil); rerr != nil {
			t.Fatal(rerr)
		}
		return errAbort
	})
	if !errors.Is(err, errAbort) {
		t.Fatalf("aborted transaction returned %v, want the abort", err)
	}
}

func TestRecordCommitsWithTheTransactionAndVanishesWithItsRollback(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{{Type: typRequest}}, nil)
	ctx := context.Background()
	recordAndAbort(t, r, "req/rolled-back")
	if err := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		data := map[string]string{"note": "hi"}
		return r.bus.Recorder().With(tx).Record(ctx, "", typRequest, "req/committed", data)
	}); err != nil {
		t.Fatal(err)
	}
	evs := r.list(t)
	if len(evs) != 1 || evs[0].Subject != "req/committed" ||
		string(evs[0].Data) != `{"note": "hi"}` {
		t.Fatalf("events = %+v", evs)
	}
}

func TestRecordOfAnUndeclaredTypeFails(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{{Type: "declared.one"}}, nil)
	err := r.bus.Recorder().Record(context.Background(), "", "never.declared", "x", nil)
	if !errors.Is(err, events.ErrUndeclaredType) {
		t.Fatalf("err = %v, want ErrUndeclaredType", err)
	}
}

func TestExposureDefaultsToInternal(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{{Type: "a.b"}, {Type: "c.d", Exposure: events.Webhook}}, nil)
	got := r.bus.WebhookTypes()
	if len(got) != 1 || got[0].Type != "c.d" {
		t.Fatalf("webhook-exposed types = %+v, want only the one declared Webhook", got)
	}
}

// — declarations —

func TestGlobMatching(t *testing.T) {
	t.Parallel()
	cases := []struct {
		glob, typ string
		want      bool
	}{
		{"corpus.note.*", typNoteChanged, true},
		{"corpus.note.*", "corpus.notes.changed", false},
		{"corpus.*", typNoteChanged, true},
		{typNoteChanged, typNoteChanged, true},
		{"*", "anything.at.all", true},
		{typRequest, "access_request.approved", false},
	}
	for _, c := range cases {
		if got := events.Match(c.glob, c.typ); got != c.want {
			t.Fatalf("Match(%q,%q) = %v", c.glob, c.typ, got)
		}
	}
}

func TestDeclarationErrorsSurfaceAtConstruction(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	types := []events.Type{noteChanged}
	if _, err := events.New(pool, []events.Type{noteChanged, noteChanged}, nil); err == nil {
		t.Fatal("duplicate type accepted")
	}
	dup := []events.Subscription{sub("x", "corpus.*"), sub("x", "corpus.*")}
	if _, err := events.New(pool, types, dup); err == nil {
		t.Fatal("duplicate subscriber accepted")
	}
	unmatched := []events.Subscription{sub("y", "nothing.matches")}
	if _, err := events.New(pool, types, unmatched); err == nil {
		t.Fatal("a subscription that matches no declared type accepted")
	}
	bad := sub("z", "corpus.*")
	bad.Handle = nil
	if _, err := events.New(pool, types, []events.Subscription{bad}); err == nil {
		t.Fatal("subscription without a handler accepted")
	}
}
