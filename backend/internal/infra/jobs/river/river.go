// Package river — the River implementation of internal/infra/jobs. The only package that may
// import riverqueue (gate: check-queue-behind-port.sh).
//
// Kinds stay strings: one raw-JSON args type carries any declared kind. Its Kind() is the
// declared name, and its KindAliases() lists every declared name, so River registers one worker
// under each string. Nothing River-typed leaves this package.
package river

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/riverdriver/riverpgxv5"
	"github.com/riverqueue/river/rivermigrate"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// MaxWaiters — how many requests may wait for a job at once. Past it, Wait returns at once and
// the caller hands out its receipt instead of queueing.
const MaxWaiters = 64

const (
	primaryKind      = "standmeet.job"
	finalChannel     = "standmeet_job_final"
	defaultStopGrace = 20 * time.Second
	stopSlack        = 5 * time.Second // Stop's deadline past the grace
	periodicTimeout  = 10 * time.Minute
	relayConns       = 1
	jitterFraction   = 10 // ±1/10 of the backoff
	idBase           = 10 // job ids travel as decimal strings
)

// Options — tuning; zero values take River's defaults.
type Options struct {
	Log               *slog.Logger
	FetchPollInterval time.Duration
	StopGrace         time.Duration // how long Stop waits for running jobs; 0 → 20 s
}

// Migrate — creates or upgrades River's own tables with River's migrator. River owns this DDL;
// schema.sql does not copy it.
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	m, err := rivermigrate.New(riverpgxv5.New(pool), nil)
	if err != nil {
		return fmt.Errorf("river migrator: %w", err)
	}
	if _, err = m.Migrate(ctx, rivermigrate.DirectionUp, nil); err != nil {
		return fmt.Errorf("river migrate: %w", err)
	}
	return nil
}

// — the runtime —

type runtime struct {
	client    *river.Client[pgx.Tx]
	pool      *pgxpool.Pool
	tx        pgx.Tx
	kinds     map[string]jobs.Kind
	final     *pgstore.Listener
	log       *slog.Logger
	cancel    context.CancelFunc
	done      chan struct{}
	periodics []jobs.Periodic
	stopGrace time.Duration
}

// New — builds the runtime. Declaration errors, duplicate kinds and a pool too small for the
// workers are errors here, at boot, not surprises in production.
//
//nolint:ireturn // the whole point is to hand out the interface
func New(
	pool *pgxpool.Pool, kinds []jobs.Kind, periodics []jobs.Periodic, opts Options,
) (jobs.Runtime, error) {
	if err := checkPoolBudget(pool); err != nil {
		return nil, err
	}
	all, err := declared(kinds, periodics)
	if err != nil {
		return nil, err
	}
	workers, err := registerWorker(all)
	if err != nil {
		return nil, err
	}
	log := logOr(opts.Log)
	grace := cmpOr(opts.StopGrace, defaultStopGrace)
	client, err := river.NewClient(riverpgxv5.New(pool), &river.Config{
		Queues:            queueConfigs(),
		Workers:           workers,
		PeriodicJobs:      riverPeriodics(periodics),
		FetchPollInterval: opts.FetchPollInterval,
		FetchCooldown:     min(opts.FetchPollInterval, river.FetchCooldownDefault),
		SoftStopTimeout:   grace,
		Logger:            log,
	})
	if err != nil {
		return nil, fmt.Errorf("river client: %w", err)
	}
	return &runtime{
		client: client, pool: pool, kinds: all, periodics: periodics,
		final: pgstore.NewListener(pool, finalChannel, MaxWaiters, log), log: log, stopGrace: grace,
	}, nil
}

// registerWorker — the one worker, registered under every declared kind name.
func registerWorker(all map[string]jobs.Kind) (*river.Workers, error) {
	names := make([]string, 0, len(all))
	for n := range all {
		names = append(names, n)
	}
	declareAliases(names)
	workers := river.NewWorkers()
	if err := river.AddWorkerSafely(workers, &worker{kinds: all}); err != nil {
		return nil, fmt.Errorf("register worker: %w", err)
	}
	return workers, nil
}

// awaitedPoll — how often a queue a request waits on polls. River sends one insert notification
// per queue per FetchCooldown (client.go maybeNotifyInsertForQueues); a job inserted just after
// another sends none, and after the worker's fetch it would sit until the 1 s default poll. A
// write inserts two index jobs ~5 ms apart (raw, then wiki), so every second one paid ~0.5 s.
const awaitedPoll = 100 * time.Millisecond

// queueConfigs — River's queue table from jobs.QueueWorkers; awaited queues poll every awaitedPoll.
func queueConfigs() map[string]river.QueueConfig {
	queues := make(map[string]river.QueueConfig, len(jobs.QueueWorkers))
	for q, n := range jobs.QueueWorkers {
		cfg := river.QueueConfig{MaxWorkers: n}
		if jobs.QueueAwaited[q] {
			cfg.FetchPollInterval = awaitedPoll
		}
		queues[q] = cfg
	}
	return queues
}

// logOr — log, or a logger that discards when log is nil.
func logOr(log *slog.Logger) *slog.Logger {
	if log == nil {
		return slog.New(slog.DiscardHandler)
	}
	return log
}

func cmpOr(d, def time.Duration) time.Duration {
	if d > 0 {
		return d
	}
	return def
}

// checkPoolBudget — every worker plus the relay may hold a connection at once; that must fit in
// half the pool, so visitor requests always keep the other half.
func checkPoolBudget(pool *pgxpool.Pool) error {
	need := relayConns
	for _, n := range jobs.QueueWorkers {
		need += n
	}
	if limit := int(pool.Config().MaxConns) / 2; need > limit {
		return fmt.Errorf(
			"job workers need %d connections but half the pool is %d: raise MaxConns", need, limit)
	}
	return nil
}

func declared(kinds []jobs.Kind, periodics []jobs.Periodic) (map[string]jobs.Kind, error) {
	all := make(map[string]jobs.Kind, len(kinds)+len(periodics))
	for i := range kinds {
		if err := addKind(all, &kinds[i]); err != nil {
			return nil, err
		}
	}
	for _, p := range periodics {
		if err := addPeriodic(all, p); err != nil {
			return nil, err
		}
	}
	return all, nil
}

// addPeriodic — validates p and adds the job kind it runs as.
func addPeriodic(all map[string]jobs.Kind, p jobs.Periodic) error {
	k, err := periodicKind(p)
	if err != nil {
		return err
	}
	return addKind(all, &k)
}

// addKind — validates k and adds it to all; a name declared twice is an error.
func addKind(all map[string]jobs.Kind, k *jobs.Kind) error {
	if err := k.Validate(); err != nil {
		return err //nolint:wrapcheck // already names the kind
	}
	if _, dup := all[k.Name]; dup {
		return fmt.Errorf("job kind %q declared twice", k.Name)
	}
	all[k.Name] = *k
	return nil
}

// periodicKind — the job kind a periodic declaration runs as.
func periodicKind(p jobs.Periodic) (jobs.Kind, error) {
	if p.Every <= 0 || p.Name == "" || p.Run == nil {
		return jobs.Kind{}, fmt.Errorf(
			"periodic job %q: needs a name, an interval and a run", p.Name)
	}
	run := p.Run
	return jobs.Kind{
		Name: jobs.PeriodicKind(p.Name), Queue: jobs.QueueMaintenance, MaxAttempts: 1,
		Timeout: min(p.Every, periodicTimeout),
		Handle:  func(ctx context.Context, _ json.RawMessage) error { return run(ctx) },
	}, nil
}

func riverPeriodics(periodics []jobs.Periodic) []*river.PeriodicJob {
	out := make([]*river.PeriodicJob, 0, len(periodics))
	for _, p := range periodics {
		k := jobs.PeriodicKind(p.Name)
		out = append(out, river.NewPeriodicJob(river.PeriodicInterval(p.Every),
			func() (river.JobArgs, *river.InsertOpts) {
				opts := &river.InsertOpts{Queue: jobs.QueueMaintenance, MaxAttempts: 1}
				return rawArgs{kind: k}, opts
			}, &river.PeriodicJobOpts{RunOnStart: true}))
	}
	return out
}

func (r *runtime) With(tx pgstore.Tx) jobs.Jobs { //nolint:ireturn // the interface is the contract
	cp := *r
	cp.tx = tx
	return &cp
}

func (r *runtime) Enqueue(
	ctx context.Context,
	kind string,
	args any, //nolint:forbidigo // the JSON payload; encoding/json.Marshal takes interface{}
	opts jobs.EnqueueOpts,
) (jobs.JobID, error) {
	k, ok := r.kinds[kind]
	if !ok {
		return 0, fmt.Errorf("%w: %s", jobs.ErrUnknownKind, kind)
	}
	raw, err := marshalArgs(args)
	if err != nil {
		return 0, err
	}
	io := &river.InsertOpts{Queue: k.Queue, MaxAttempts: k.MaxAttempts, ScheduledAt: opts.RunAt}
	io.UniqueOpts.ByArgs = opts.UniqueByArgs
	return r.insert(ctx, rawArgs{kind: kind, raw: raw}, io)
}

//nolint:forbidigo // args is the JSON payload; encoding/json.Marshal takes interface{}
func marshalArgs(args any) (json.RawMessage, error) {
	switch a := args.(type) {
	case nil:
		return json.RawMessage("{}"), nil
	case json.RawMessage:
		return a, nil
	default:
		b, err := json.Marshal(a)
		if err != nil {
			return nil, fmt.Errorf("marshal job args: %w", err)
		}
		return b, nil
	}
}

// insert — the River insert, inside r's transaction when it has one.
func (r *runtime) insert(
	ctx context.Context, args rawArgs, io *river.InsertOpts,
) (jobs.JobID, error) {
	if r.tx != nil {
		out, err := r.client.InsertTx(ctx, r.tx, args, io)
		if err != nil {
			return 0, fmt.Errorf("enqueue %s: %w", args.kind, err)
		}
		return jobs.JobID(out.Job.ID), nil
	}
	out, err := r.client.Insert(ctx, args, io)
	if err != nil {
		return 0, fmt.Errorf("enqueue %s: %w", args.kind, err)
	}
	return jobs.JobID(out.Job.ID), nil
}
