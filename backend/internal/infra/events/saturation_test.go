package events_test

// Saturation: Postgres refuses writes (a full disk), simulated with triggers that raise the error
// Postgres gives when it cannot extend a file (docs/design/event-bus-outbox-webhooks.md, *Test
// plan* › "Saturation and degradation UTs").

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

const (
	diskFull     = "could not extend file: No space left on device"
	refuseWrites = `CREATE FUNCTION refuse_write() RETURNS trigger LANGUAGE plpgsql AS $$
		BEGIN RAISE EXCEPTION 'could not extend file: No space left on device'; END $$`
	refuseEventInserts = `CREATE TRIGGER disk_full BEFORE INSERT ON events
		FOR EACH ROW EXECUTE FUNCTION refuse_write()`
	refuseRelayWrites = `CREATE TRIGGER disk_full_jobs BEFORE INSERT ON river_job
		FOR EACH ROW EXECUTE FUNCTION refuse_write();
		CREATE TRIGGER disk_full_stamp BEFORE UPDATE ON events
		FOR EACH ROW EXECUTE FUNCTION refuse_write()`
	relayPassFailed = "events: relay pass"
	failedPasses    = 3
	passesDeadline  = 20 * time.Second
	// growthFloor —— the second wait must be at least this many times the first (exactly 2 with
	// doubling; a fixed interval gives 1).
	growthFloor = 1.5
)

// passClock —— a log handler that records when each failed relay pass was logged.
type passClock struct {
	times []time.Time
	mu    sync.Mutex
}

func (*passClock) Enabled(context.Context, slog.Level) bool { return true }

//nolint:gocritic // hugeParam: slog.Handler's own signature takes the record by value
func (p *passClock) Handle(_ context.Context, r slog.Record) error {
	if r.Message == relayPassFailed {
		p.mu.Lock()
		p.times = append(p.times, time.Now())
		p.mu.Unlock()
	}
	return nil
}

func (p *passClock) WithAttrs([]slog.Attr) slog.Handler { return p }

func (p *passClock) WithGroup(string) slog.Handler { return p }

func (p *passClock) snapshot() []time.Time {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]time.Time(nil), p.times...)
}

// awaitPasses —— the times of the first n failed passes.
func (p *passClock) awaitPasses(t *testing.T, n int) []time.Time {
	t.Helper()
	deadline := time.Now().Add(passesDeadline)
	for time.Now().Before(deadline) {
		if got := p.snapshot(); len(got) >= n {
			return got[:n]
		}
		time.Sleep(rigFetchPoll)
	}
	t.Fatalf("saw %d failed relay passes, want %d", len(p.snapshot()), n)
	return nil
}

// execAll —— runs each statement, failing the test on an error.
func (r *rig) execAll(t *testing.T, stmts ...string) {
	t.Helper()
	for _, s := range stmts {
		if _, err := r.pool.Exec(context.Background(), s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

// changedAndEmitted —— how many notes exist and how many events were written.
func (r *rig) changedAndEmitted(t *testing.T) [2]int {
	t.Helper()
	var n [2]int
	q := `SELECT (SELECT count(*) FROM corpus_notes), (SELECT count(*) FROM events)`
	if err := r.pool.QueryRow(context.Background(), q).Scan(&n[0], &n[1]); err != nil {
		t.Fatal(err)
	}
	return n
}

// refusedForDiskFull —— the write was refused with the disk-full error.
func refusedForDiskFull(err error) bool {
	return err != nil && strings.Contains(err.Error(), diskFull)
}

// writeNoteAndRecord —— the two ways an event is born: a note insert (the trigger emits) and a
// business write with a recorded fact in the same transaction. Returns each one's error.
func (r *rig) writeNoteAndRecord(owner string) [2]error {
	ctx := context.Background()
	_, noteErr := r.pool.Exec(ctx, `INSERT INTO corpus_notes (owner_id, genre, title, body, slug)
		VALUES ($1, 'wiki', 'Full', 'body', 's-full')`, owner)
	recordErr := pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		if _, err := tx.Exec(ctx, `UPDATE owners SET full_name = 'Changed' WHERE id = $1`,
			owner); err != nil {
			return err
		}
		return r.bus.Recorder().With(tx).Record(ctx, owner, typRequest, "req/full", nil)
	})
	return [2]error{noteErr, recordErr}
}

// assertRefusedTogether —— with event inserts refused, both writes fail with the disk-full error
// and neither leaves its change behind.
func (r *rig) assertRefusedTogether(t *testing.T, owner string) {
	t.Helper()
	for i, err := range r.writeNoteAndRecord(owner) {
		if !refusedForDiskFull(err) {
			t.Fatalf("write %d with the disk full: %v, want it refused with the disk-full error",
				i, err)
		}
	}
	if got := r.changedAndEmitted(t); got != [2]int{0, 0} || r.ownerName(t, owner) != "O" {
		t.Fatalf("notes, events = %v; owner %q: a refused write left half of itself behind",
			got, r.ownerName(t, owner))
	}
}

// assertLandsTogether —— with writes accepted again, each change lands with its event.
func (r *rig) assertLandsTogether(t *testing.T, owner string) {
	t.Helper()
	if errs := r.writeNoteAndRecord(owner); errs != [2]error{} {
		t.Fatalf("after the disk frees up: %v", errs)
	}
	if got := r.changedAndEmitted(t); got != [2]int{1, 2} || r.ownerName(t, owner) != "Changed" {
		t.Fatalf("notes, events = %v, want the note with its event and the recorded fact", got)
	}
}

func (r *rig) ownerName(t *testing.T, owner string) string {
	t.Helper()
	var name string
	if err := r.pool.QueryRow(context.Background(), `SELECT full_name FROM owners WHERE id = $1`,
		owner).Scan(&name); err != nil {
		t.Fatal(err)
	}
	return name
}

// TestADiskFullFailsTheWriteWithItsEventAndTheRelayBacksOff — Postgres refuses writes. A business
// write and its event fail together, with a readable error: never "changed but no event". Once
// writes work again both land. Then the relay's own writes are refused, and the wait between its
// failing passes grows instead of spinning at a fixed rate.
func TestADiskFullFailsTheWriteWithItsEventAndTheRelayBacksOff(t *testing.T) {
	t.Parallel()
	r := newRig(t, []events.Type{noteChanged, {Type: typRequest}}, indexSub())
	owner := seedOwner(t, r.pool)
	r.execAll(t, refuseWrites, refuseEventInserts)
	r.assertRefusedTogether(t, owner)
	r.execAll(t, `DROP TRIGGER disk_full ON events`)
	r.assertLandsTogether(t, owner)
	r.assertRelayBacksOff(t)
}

// assertRelayBacksOff —— one event waits to be fanned out and the relay's writes are refused: the
// gaps between its failed passes grow.
func (r *rig) assertRelayBacksOff(t *testing.T) {
	t.Helper()
	r.fanOut(t)
	r.record(t, typNoteChanged, "wiki://stuck", nil)
	r.execAll(t, refuseRelayWrites)
	clock := &passClock{}
	r.bus.SetLogger(slog.New(clock))
	r.startRelay(context.Background(), t)
	at := clock.awaitPasses(t, failedPasses)
	first, second := at[1].Sub(at[0]), at[2].Sub(at[1])
	if float64(second) < growthFloor*float64(first) {
		t.Fatalf("relay retried after %s then %s: the interval must grow, not spin", first, second)
	}
}
