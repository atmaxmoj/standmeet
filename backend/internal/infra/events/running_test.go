package events_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

const (
	deliverWait = 10 * time.Second
	earlyAwait  = 100 * time.Millisecond
	fanoutAwait = 5 * time.Second
	ageOldRows  = `UPDATE events SET occurred_at = now() - interval '8 days'
		WHERE subject LIKE 'wiki://old%'`
)

// startJobs — runs the rig's job workers until the test ends.
func (r *rig) startJobs(t *testing.T) {
	t.Helper()
	if err := r.jobs.Start(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := r.jobs.Stop(context.Background()); err != nil {
			t.Errorf("stop jobs: %v", err)
		}
	})
}

// startRelay — runs the bus's relay until the test ends.
func (r *rig) startRelay(ctx context.Context, t *testing.T) {
	t.Helper()
	r.bus.Start(ctx, r.jobs)
	t.Cleanup(r.bus.Stop)
}

func assertLiveEvent(t *testing.T, e *events.Event) {
	t.Helper()
	var d map[string]string
	if err := json.Unmarshal(e.Data, &d); err != nil {
		t.Fatalf("event data: %v", err)
	}
	if e.Type != typNoteChanged || e.Subject != "wiki://live" || d["op"] != "updated" {
		t.Fatalf("event = %+v", e)
	}
}

func TestSubscriberReceivesTheEvent(t *testing.T) {
	t.Parallel()
	got := make(chan events.Event, 1)
	s := sub(subIndex, "corpus.note.*")
	s.Handle = func(_ context.Context, e events.Event) error {
		got <- e
		return nil
	}
	r := newRig(t, []events.Type{noteChanged}, []events.Subscription{s})
	r.startJobs(t)
	r.startRelay(context.Background(), t)
	r.record(t, typNoteChanged, "wiki://live", map[string]string{"op": "updated"})
	select {
	case e := <-got:
		assertLiveEvent(t, &e)
	case <-time.After(deliverWait):
		t.Fatal("the running relay never delivered the event (LISTEN wake-up or timer broken)")
	}
}

// latestFor — the newest note-changed event whose note_id is noteID; fails when there is none.
func (r *rig) latestFor(t *testing.T, noteID string) string {
	t.Helper()
	id, err := r.bus.LatestFor(context.Background(), typNoteChanged, "note_id", noteID)
	if err != nil || id == "" {
		t.Fatalf("LatestFor = %q, %v", id, err)
	}
	return id
}

// awaitMisses — fails with msg when AwaitFanout does return a job.
func (r *rig) awaitMisses(t *testing.T, id, subscriber string, wait time.Duration, msg string) {
	t.Helper()
	if _, ok := r.bus.AwaitFanout(context.Background(), id, subscriber, wait); ok {
		t.Fatal(msg)
	}
}

func TestAwaitFanoutReturnsTheSubscribersJobOnceTheRelayHasRun(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged}, indexSub())
	ctx := context.Background()
	r.record(t, typNoteChanged, "wiki://wait", map[string]string{"note_id": "n-42"})
	id := r.latestFor(t, "n-42")
	r.awaitMisses(t, id, subIndex, earlyAwait, "AwaitFanout succeeded before any relay ran")
	r.startRelay(ctx, t)
	job, ok := r.bus.AwaitFanout(ctx, id, subIndex, fanoutAwait)
	if !ok || job == 0 || r.jobCount(t, subIndex) != 1 {
		t.Fatalf("AwaitFanout = %d,%v", job, ok)
	}
	r.awaitMisses(t, id, "no.such.subscriber", time.Second,
		"AwaitFanout returned a job for a subscriber that did not match")
}

func (r *rig) subjects(t *testing.T) map[string]bool {
	t.Helper()
	out := map[string]bool{}
	evs := r.list(t)
	for i := range evs {
		out[evs[i].Subject] = true
	}
	return out
}

func TestRetentionDeletesOnlyFannedOutRowsOlderThanTheWindow(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged}, indexSub())
	ctx := context.Background()
	r.record(t, typNoteChanged, "wiki://old-fanned", nil)
	r.fanOut(t)
	r.record(t, typNoteChanged, "wiki://old-unfanned", nil)
	r.record(t, typNoteChanged, "wiki://fresh", nil)
	if _, err := r.pool.Exec(ctx, ageOldRows); err != nil {
		t.Fatalf("age the old rows: %v", err)
	}
	deleted, err := r.bus.PruneOlderThan(ctx, events.Retention)
	if err != nil {
		t.Fatal(err)
	}
	left := r.subjects(t)
	kept := [3]bool{left["wiki://old-unfanned"], left["wiki://fresh"], left["wiki://old-fanned"]}
	if deleted != 1 || kept != [3]bool{true, true, false} {
		t.Fatalf("deleted %d, left %v", deleted, left)
	}
}
