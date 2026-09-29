package subscriber_test

// Saturation: Meili fully down (docs/design/event-bus-outbox-webhooks.md, *Test plan* ›
// "Saturation and degradation UTs"). The real indexer and search client against an httptest
// stand-in for Meili's HTTP API; real Postgres, the real trigger, relay and River workers.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/search"
	"github.com/atmaxmoj/standmeet/internal/corpus/subscriber"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
)

const (
	backlogNotes = 5
	rigPoll      = 20 * time.Millisecond
	rigGrace     = time.Second
	drainWait    = 30 * time.Second
	taskPath     = "/tasks/"
	docsPath     = "/indexes/corpus_notes/documents"
)

// meili —— a stand-in for Meili's document and task endpoints. While down, every request gets a
// 500 (not in the client's own retry list, so each failure reaches the job layer).
type meili struct {
	docs map[string]search.Doc
	mu   sync.Mutex
	down atomic.Bool
	task atomic.Int64
}

func (m *meili) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if m.down.Load() {
		http.Error(w, `{"message":"meili is down"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if r.Method == http.MethodPost && r.URL.Path == docsPath {
		m.add(w, r)
		return
	}
	uid, isTask := strings.CutPrefix(r.URL.Path, taskPath)
	if !isTask {
		http.NotFound(w, r)
		return
	}
	//nolint:errcheck // a stand-in's reply; the client's decode is the check
	_, _ = fmt.Fprintf(w, `{"uid":%s,"indexUid":"corpus_notes","status":"succeeded"}`, uid)
}

func (m *meili) add(w http.ResponseWriter, r *http.Request) {
	var docs []search.Doc
	if err := json.NewDecoder(r.Body).Decode(&docs); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	m.mu.Lock()
	for i := range docs {
		m.docs[docs[i].ID] = docs[i]
	}
	m.mu.Unlock()
	w.WriteHeader(http.StatusAccepted)
	//nolint:errcheck // a stand-in's reply; the client's decode is the check
	_, _ = fmt.Fprintf(w, `{"taskUid":%d,"indexUid":"corpus_notes","status":"enqueued"}`,
		m.task.Add(1))
}

func (m *meili) indexed() map[string]bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make(map[string]bool, len(m.docs))
	for id := range m.docs {
		out[id] = true
	}
	return out
}

// writeNotes —— n wiki notes of a new owner; the trigger records one event per note. Returns the
// note ids.
func writeNotes(t *testing.T, pool *pgxpool.Pool, n int) []string {
	t.Helper()
	ctx := context.Background()
	var owner string
	if err := pool.QueryRow(ctx, `INSERT INTO owners (email, password_hash, handle, full_name)
		VALUES ('o@example.com', 'x', 'o', 'O') RETURNING id`).Scan(&owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	ids := make([]string, 0, n)
	for i := range n {
		var id string
		if err := pool.QueryRow(ctx, `INSERT INTO corpus_notes (owner_id, genre, title, body, slug)
			VALUES ($1, 'wiki', $2, 'body', $2) RETURNING id`, owner,
			fmt.Sprintf("note-%d", i)).Scan(&id); err != nil {
			t.Fatalf("a write while Meili is down: %v", err)
		}
		ids = append(ids, id)
	}
	return ids
}

// indexingRuntime —— the bus with the corpus subscriptions and a River runtime for its kinds.
func indexingRuntime(
	t *testing.T, pool *pgxpool.Pool, ix usecase.Indexer,
) (*events.Bus, jobs.Runtime) {
	t.Helper()
	bus, err := events.New(pool, subscriber.EventTypes(), subscriber.Subscriptions(ix))
	if err != nil {
		t.Fatal(err)
	}
	if err = jobsriver.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	opts := jobsriver.Options{FetchPollInterval: rigPoll, StopGrace: rigGrace}
	rt, err := jobsriver.New(pool, append(bus.Kinds(), subscriber.Kinds(ix)...), nil, opts)
	if err != nil {
		t.Fatal(err)
	}
	return bus, rt
}

// runIndexing —— the relay and started River workers, stopped when the test ends.
func runIndexing(t *testing.T, pool *pgxpool.Pool, ix usecase.Indexer) jobs.Runtime {
	t.Helper()
	ctx := context.Background()
	bus, rt := indexingRuntime(t, pool, ix)
	if err := rt.Start(ctx); err != nil {
		t.Fatal(err)
	}
	bus.Start(ctx, rt)
	t.Cleanup(func() {
		bus.Stop()
		if serr := rt.Stop(context.Background()); serr != nil {
			t.Errorf("stop jobs: %v", serr)
		}
	})
	return rt
}

// indexJobs —— every corpus.index job.
func indexJobs(t *testing.T, rt jobs.Runtime) []jobs.Job {
	t.Helper()
	got, err := rt.List(context.Background(), jobs.Filter{Kind: subscriber.IndexSubscriber})
	if err != nil {
		t.Fatal(err)
	}
	return got
}

// everyJob —— n index jobs exist and each satisfies ok.
func everyJob(t *testing.T, rt jobs.Runtime, n int, ok func(*jobs.Job) bool) bool {
	t.Helper()
	got := indexJobs(t, rt)
	if len(got) != n {
		return false
	}
	for i := range got {
		if got[i].State == jobs.StateDiscarded {
			t.Fatalf("index job %d was discarded: %v", got[i].ID, got[i].Errors)
		}
		if !ok(&got[i]) {
			return false
		}
	}
	return true
}

func until(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(drainWait)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(rigPoll)
	}
}

// TestIndexJobsRideOutMeiliBeingDown — Meili is down: note writes still succeed, and every index
// job fails, backs off and waits to retry. Meili comes back: every backlogged job completes, none
// is discarded, and the index holds every note.
func TestIndexJobsRideOutMeiliBeingDown(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	stand := &meili{docs: map[string]search.Doc{}}
	stand.down.Store(true)
	srv := httptest.NewServer(stand)
	t.Cleanup(srv.Close)
	ix := usecase.NewCorpusIndexer(search.New(srv.URL, ""), repo.NewVaultSyncRepo(pool))
	rt := runIndexing(t, pool, ix)
	ids := writeNotes(t, pool, backlogNotes)
	until(t, "every index job to fail against the dead Meili", func() bool {
		return everyJob(t, rt, backlogNotes, func(j *jobs.Job) bool {
			return j.State == jobs.StateRetryable && len(j.Errors) > 0
		})
	})
	stand.down.Store(false)
	until(t, "the backlog to drain after Meili recovers", func() bool {
		return everyJob(t, rt, backlogNotes, func(j *jobs.Job) bool {
			return j.State == jobs.StateCompleted
		})
	})
	got := stand.indexed()
	for _, id := range ids {
		if !got[id] {
			t.Fatalf("note %s is missing from the index after recovery (indexed: %v)", id, got)
		}
	}
}
