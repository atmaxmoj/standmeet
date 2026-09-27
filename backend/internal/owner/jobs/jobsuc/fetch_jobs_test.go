package jobsuc_test

// jobs.fetch_new runs one job per source and waits for them: sources that finish in time answer
// with the full result; a source that does not answers with a receipt, and jobs.fetch_result gives
// the same full result once it finishes.

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	jobsriver "github.com/atmaxmoj/standmeet/internal/infra/jobs/river"
	jobcache "github.com/atmaxmoj/standmeet/internal/owner/jobs/cache"
	jobfetch "github.com/atmaxmoj/standmeet/internal/owner/jobs/fetch"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc"
)

// board —— a RemoteOK-shaped answer with two postings.
const board = `[{"legal":"notice"},
	{"id":"r1","position":"Go Engineer","company":"Acme","url":"https://acme.example/1"},
	{"id":"r2","position":"SRE","company":"Beta","url":"https://beta.example/2"}]`

const (
	postings    = 2
	fetchPoll   = 50 * time.Millisecond
	settleBound = 10 * time.Second
)

type fetchRig struct {
	pool  *pgxpool.Pool
	deps  jobsuc.JobsDeps
	owner string
}

// newFetchRig —— real Postgres, River and a Redis pool; the board is h.
func newFetchRig(t *testing.T, h http.HandlerFunc, wait time.Duration) *fetchRig {
	t.Helper()
	pool := scratchDB(t)
	if err := jobsriver.Migrate(context.Background(), pool); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	bus, err := events.New(pool, jobsuc.FetchEventTypes(), nil)
	if err != nil {
		t.Fatal(err)
	}
	rdb := redis.NewClient(&redis.Options{Addr: miniredis.RunT(t).Addr()})
	r := &fetchRig{pool: pool, owner: seedOwner(t, pool, "fetcher")}
	r.deps = jobsuc.JobsDeps{
		Sources: jobsuc.NewJobSourceRepo(pool), Cache: jobcache.New(rdb, 0),
		Registry: jobfetch.New(&jobfetch.BaseURLs{RemoteOK: srv.URL}),
		Pool:     pool, Wait: wait, Events: bus.Recorder,
	}
	rt := startRuntime(t, pool, jobsuc.FetchKinds(&r.deps))
	r.deps.Queue = func() jobs.Runtime { return rt }
	return r
}

//nolint:ireturn // the jobs port is the contract
func startRuntime(t *testing.T, pool *pgxpool.Pool, kinds []jobs.Kind) jobs.Runtime {
	t.Helper()
	opts := jobsriver.Options{FetchPollInterval: fetchPoll, StopGrace: time.Second}
	rt, err := jobsriver.New(pool, kinds, nil, opts)
	if err != nil {
		t.Fatal(err)
	}
	if err = rt.Start(t.Context()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if serr := rt.Stop(context.Background()); serr != nil {
			t.Logf("stop jobs: %v", serr)
		}
	})
	return rt
}

func seedOwner(t *testing.T, pool *pgxpool.Pool, handle string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name) VALUES ($1, 'x', $2, 'O') RETURNING id`,
		handle+"@example.com", handle).Scan(&id); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	return id
}

func (r *fetchRig) source(t *testing.T) {
	t.Helper()
	in := &jobsmodel.CreateJobSourceInput{
		OwnerID: r.owner, Kind: jobfetch.KindRemoteOK, Label: "RemoteOK", Config: []byte(`{}`),
	}
	if _, err := jobsuc.RegisterJobSource(context.Background(), r.deps, in); err != nil {
		t.Fatal(err)
	}
}

func serveBoard(w http.ResponseWriter) {
	if _, err := w.Write([]byte(board)); err != nil {
		panic(err) // the test's own server: a failed write is a broken rig
	}
}

// wantFullResult —— both postings, new this fetch, and one clean tally for the one source.
func wantFullResult(t *testing.T, res *jobsuc.FetchResult) {
	t.Helper()
	if newRows(res) != postings || len(res.Jobs) != postings {
		t.Fatalf("want the two postings, new this fetch; got %+v", res.Jobs)
	}
	if len(res.Tallies) != 1 || res.Tallies[0].Pooled != postings {
		t.Fatalf("want one source's tally with 2 pooled; got %+v", res.Tallies)
	}
}

func newRows(res *jobsuc.FetchResult) int {
	n := 0
	for i := range res.Jobs {
		if res.Jobs[i].New {
			n++
		}
	}
	return n
}

// TestFetchNew_inTime —a board that answers at once: fetch_new returns the full result, not a
// receipt, and jobs.fetched records how many were new.
func TestFetchNew_inTime(t *testing.T) {
	t.Parallel()
	r := newFetchRig(t, func(w http.ResponseWriter, _ *http.Request) { serveBoard(w) }, settleBound)
	r.source(t)
	out, err := jobsuc.FetchNewJobs(context.Background(), r.deps, r.owner, nil, 0)
	if err != nil || out.Receipt != nil {
		t.Fatalf("a fast board must answer in full, got receipt %+v (%v)", out.Receipt, err)
	}
	wantFullResult(t, &out.Result)
	var n int
	if err = r.pool.QueryRow(context.Background(), `SELECT (data->>'new_count')::int FROM events
		WHERE type = $1 AND subject = $2`, jobsuc.JobsFetched, "jobs/"+r.owner,
	).Scan(&n); err != nil || n != postings {
		t.Fatalf("jobs.fetched: want new_count 2, got %d (%v)", n, err)
	}
}

// TestFetchNew_slowSourceReceipt — a board slower than the wait: a receipt; fetch_result says
// pending until the board answers, then the same full result.
func TestFetchNew_slowSourceReceipt(t *testing.T) {
	t.Parallel()
	release := make(chan struct{})
	r := newFetchRig(t, func(w http.ResponseWriter, req *http.Request) {
		select {
		case <-release:
			serveBoard(w)
		case <-req.Context().Done():
		}
	}, time.Second)
	r.source(t)
	ids := r.receiptOfFetch(t)
	if again := r.resultOf(t, r.owner, ids); again.Receipt == nil {
		t.Fatal("fetch_result before the board answers must still be a receipt")
	}
	close(release)
	res := awaitResult(t, r, ids)
	wantFullResult(t, &res)
}

// TestFetchResult_ownerOnly — another owner cannot read a fetch by its job ids.
func TestFetchResult_ownerOnly(t *testing.T) {
	t.Parallel()
	r := newFetchRig(t, func(w http.ResponseWriter, _ *http.Request) { serveBoard(w) }, settleBound)
	r.source(t)
	out, err := jobsuc.FetchNewJobs(context.Background(), r.deps, r.owner, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	ids := make([]jobs.JobID, 0, len(out.Result.Tallies))
	for _, tally := range out.Result.Tallies {
		ids = append(ids, r.jobOf(t, tally.SourceID))
	}
	stranger := seedOwner(t, r.pool, "stranger")
	_, err = jobsuc.FetchResultOf(context.Background(), r.deps, stranger, ids, 0)
	if !errors.Is(err, jobsuc.ErrFetchNotFound) {
		t.Fatalf("another owner's fetch: want ErrFetchNotFound, got %v", err)
	}
}

// receiptOfFetch —— fetch_new, which must answer with a pending receipt of one job.
func (r *fetchRig) receiptOfFetch(t *testing.T) []jobs.JobID {
	t.Helper()
	out, err := jobsuc.FetchNewJobs(context.Background(), r.deps, r.owner, nil, 0)
	if err != nil || out.Receipt == nil || len(out.Receipt.JobIDs) != 1 {
		t.Fatalf("a slow board must answer with a receipt of 1 job, got %+v (%v)",
			out.Receipt, err)
	}
	return out.Receipt.JobIDs
}

func (r *fetchRig) resultOf(t *testing.T, owner string, ids []jobs.JobID) jobsuc.FetchOutcome {
	t.Helper()
	out, err := jobsuc.FetchResultOf(context.Background(), r.deps, owner, ids, 0)
	if err != nil {
		t.Fatal(err)
	}
	return out
}

// jobOf —— the fetch job of source, read back from the job table.
func (r *fetchRig) jobOf(t *testing.T, source string) jobs.JobID {
	t.Helper()
	var id int64
	if err := r.pool.QueryRow(context.Background(), `SELECT id FROM river_job
		WHERE kind = $1 AND args->>'source_id' = $2`, jobsuc.FetchSourceKind, source,
	).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return jobs.JobID(id)
}

func awaitResult(t *testing.T, r *fetchRig, ids []jobs.JobID) jobsuc.FetchResult {
	t.Helper()
	deadline := time.Now().Add(settleBound)
	for time.Now().Before(deadline) {
		if out := r.resultOf(t, r.owner, ids); out.Receipt == nil {
			return out.Result
		}
		time.Sleep(fetchPoll)
	}
	t.Fatal("the fetch never finished after the board answered")
	return jobsuc.FetchResult{}
}
