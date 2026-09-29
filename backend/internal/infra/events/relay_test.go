package events_test

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

const (
	subNotify         = "owner.notify"
	extraRows         = 50
	concurrentEvents  = 500
	relayWorkers      = 4
	sameSubjectEvents = 5
)

func TestFanOutEnqueuesOneJobPerMatchingSubscriberAndMarksTheRows(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged, {Type: typRequest}},
		[]events.Subscription{sub(subIndex, "corpus.note.*"), sub(subNotify, "access_request.*")})
	r.record(t, typNoteChanged, "wiki://a", nil)
	r.record(t, typNoteChanged, "wiki://b", nil)
	r.record(t, typRequest, "req/1", nil)
	if n := r.fanOut(t); n != 3 {
		t.Fatalf("fanned out %d events, want 3", n)
	}
	got := [3]int{r.jobCount(t, subIndex), r.jobCount(t, subNotify), r.unfanned(t)}
	if got != [3]int{2, 1, 0} {
		t.Fatalf("index=%d notify=%d unfanned=%d", got[0], got[1], got[2])
	}
	if n := r.fanOut(t); n != 0 {
		t.Fatalf("a second pass fanned out %d, want 0", n)
	}
}

func (r *rig) get(t *testing.T, id string) events.Event {
	t.Helper()
	ev, err := r.bus.Get(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	return ev
}

func TestEventDetailListsTheJobEachSubscriberGot(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged},
		[]events.Subscription{sub(subIndex, "corpus.note.*"), sub("webhook.nudge", "corpus.*")})
	r.record(t, typNoteChanged, "wiki://x", nil)
	r.fanOut(t)
	ev := r.get(t, r.list(t)[0].ID)
	if len(ev.Fanout) != 2 || ev.FannedOutAt == nil {
		t.Fatalf("fanout = %+v", ev.Fanout)
	}
	if ev.Fanout[0].JobID == 0 || ev.Fanout[1].JobID == 0 {
		t.Fatalf("fanout = %+v", ev.Fanout)
	}
}

func TestInterleavedCommitsLoseNothing(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged}, indexSub())
	ctx := context.Background()
	// A takes its sequence number first but commits last; B commits in between and the relay
	// runs. A cursor-based relay would move past A's number and never see it.
	txA, err := r.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	err = r.bus.Recorder().With(txA).Record(ctx, "", typNoteChanged, "wiki://late", nil)
	if err != nil {
		t.Fatal(err)
	}
	r.record(t, typNoteChanged, "wiki://early", nil)
	r.fanOut(t)
	if err = txA.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	r.fanOut(t)
	if got := r.jobCount(t, subIndex); got != 2 {
		t.Fatalf("jobs = %d, want both events fanned out", got)
	}
}

func TestFanOutClaimsAtMostOneBatch(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged}, indexSub())
	for i := range events.RelayBatch + extraRows {
		r.record(t, typNoteChanged, fmt.Sprintf("wiki://n%d", i), nil)
	}
	if n := r.fanOut(t); n != events.RelayBatch {
		t.Fatalf("first pass = %d, want %d", n, events.RelayBatch)
	}
	if n := r.fanOut(t); n != extraRows {
		t.Fatalf("second pass = %d, want %d", n, extraRows)
	}
}

// relayUntilEmpty — relay passes until one fans out nothing or fails.
func (r *rig) relayUntilEmpty() {
	for {
		k, err := r.bus.FanOut(context.Background(), r.jobs)
		if err != nil || k == 0 {
			return
		}
	}
}

func TestConcurrentRelaysNeverFanOutTwice(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged}, indexSub())
	for i := range concurrentEvents {
		r.record(t, typNoteChanged, fmt.Sprintf("wiki://c%d", i), nil)
	}
	var wg sync.WaitGroup
	for range relayWorkers {
		wg.Go(r.relayUntilEmpty)
	}
	wg.Wait()
	if got := r.jobCount(t, subIndex); got != concurrentEvents {
		t.Fatalf("jobs = %d, want exactly %d", got, concurrentEvents)
	}
}

// recordVersions — n events for one subject, each carrying its version number.
func (r *rig) recordVersions(t *testing.T, subject string, n int) {
	t.Helper()
	for i := range n {
		data := map[string]int{"v": i}
		err := r.bus.Recorder().Record(context.Background(), "", typNoteChanged, subject, data)
		if err != nil {
			t.Fatalf("record: %v", err)
		}
	}
}

// latestIDOf — the newest event of a subject in a newest-first list.
func latestIDOf(evs []events.Event, subject string) string {
	for i := range evs {
		if evs[i].Subject == subject {
			return evs[i].ID
		}
	}
	return ""
}

// firstJobEventID — the event id the oldest river job carries.
func (r *rig) firstJobEventID(t *testing.T) string {
	t.Helper()
	var id string
	q := `SELECT args->>'event_id' FROM river_job ORDER BY id LIMIT 1`
	if err := r.pool.QueryRow(context.Background(), q).Scan(&id); err != nil {
		t.Fatalf("read first job: %v", err)
	}
	return id
}

// TestEverySubjectEventReachesANonCoalescingSubscriber — two different facts about one subject in
// one batch (supplier.connected then supplier.activated, both supplier/smtp) are two deliveries.
// Coalescing them once dropped supplier.connected on its way to webhooks.
func TestEverySubjectEventReachesANonCoalescingSubscriber(t *testing.T) {
	t.Parallel()
	types := []events.Type{{Type: "supplier.connected"}, {Type: "supplier.activated"}}
	r := newRig(t, types, []events.Subscription{sub("webhook.fanout", "supplier.*")})
	r.record(t, "supplier.connected", "supplier/smtp", nil)
	r.record(t, "supplier.activated", "supplier/smtp", nil)
	r.record(t, "supplier.activated", "supplier/smtp", nil)
	r.fanOut(t)
	if got := r.jobCount(t, "webhook.fanout"); got != 3 {
		t.Fatalf("jobs = %d, want one per event", got)
	}
}

func TestSameSubjectInOneBatchCoalescesToTheLatestEvent(t *testing.T) {
	t.Parallel()
	coalescing := sub(subIndex, "corpus.note.*")
	coalescing.Coalesce = true
	r := newRig(t, []events.Type{noteChanged}, []events.Subscription{coalescing})
	r.recordVersions(t, "wiki://same", sameSubjectEvents)
	r.record(t, typNoteChanged, "wiki://other", nil)
	r.fanOut(t)
	if got := r.jobCount(t, subIndex); got != 2 {
		t.Fatalf("jobs = %d, want one per subject", got)
	}
	args := r.firstJobEventID(t)
	latestSame := latestIDOf(r.list(t), "wiki://same")
	if args != latestSame {
		t.Fatalf("coalesced job carries event %s, want the latest %s", args, latestSame)
	}
	if r.unfanned(t) != 0 {
		t.Fatal("coalesced events were left unfanned")
	}
}

type failingJobs struct {
	jobs.Jobs

	failSubject string
}

func (f *failingJobs) With(tx pgstore.Tx) jobs.Jobs {
	return &failingJobs{Jobs: f.Jobs.With(tx), failSubject: f.failSubject}
}

func (f *failingJobs) Enqueue(
	ctx context.Context,
	kind string,
	args any, //nolint:forbidigo // implements jobs.Jobs.Enqueue, whose args is a JSON payload
	o jobs.EnqueueOpts,
) (jobs.JobID, error) {
	if a, ok := args.(events.JobArgs); ok && a.Subject == f.failSubject {
		return 0, errors.New("enqueue refused")
	}
	return f.Jobs.Enqueue(ctx, kind, args, o)
}

func TestAFailingBatchRollsBackEntirelyAndAPoisonRowDoesNotBlockTheRest(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged}, indexSub())
	r.record(t, typNoteChanged, "wiki://ok-1", nil)
	r.record(t, typNoteChanged, "wiki://poison", nil)
	r.record(t, typNoteChanged, "wiki://ok-2", nil)
	bad := &failingJobs{Jobs: r.jobs, failSubject: "wiki://poison"}
	for range events.PoisonAfter + 1 {
		// The poison row fails by design; the outcome is asserted on the jobs and backlog below.
		_, _ = r.bus.FanOut(context.Background(), bad) //nolint:errcheck // failure is the input
	}
	if got := r.jobCount(t, subIndex); got != 2 {
		t.Fatalf("jobs = %d, want the two healthy events fanned out", got)
	}
	b := r.backlog(t)
	if b.Poisoned != 1 || b.Unfanned != 0 {
		t.Fatalf("backlog = %+v, want the poison row set aside", b)
	}
}
