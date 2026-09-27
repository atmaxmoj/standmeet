// lifecycle.go — starting and stopping the workers, and waiting for a job to finish.

package river

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/riverqueue/river"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
)

// Start — starts the workers, the completion listener and the completion notifier.
func (r *runtime) Start(ctx context.Context) error {
	lctx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	r.cancel = cancel
	r.done = make(chan struct{})
	events, unsubscribe := r.client.Subscribe(
		river.EventKindJobCompleted, river.EventKindJobFailed, river.EventKindJobCancelled)
	if err := r.client.Start(ctx); err != nil {
		unsubscribe()
		cancel()
		return fmt.Errorf("start river: %w", err)
	}
	go r.notifyFinal(lctx, events, unsubscribe)
	go func() {
		defer close(r.done)
		r.final.Run(lctx)
	}()
	return nil
}

func (r *runtime) Stop(ctx context.Context) error {
	sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), r.stopGrace+stopSlack)
	defer cancel()
	err := r.client.Stop(sctx)
	if r.cancel != nil {
		r.cancel()
		<-r.done
		r.cancel = nil
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		return fmt.Errorf("stop river: %w", err)
	}
	return nil
}

// Wait — see jobs.Runtime.
func (r *runtime) Wait(
	ctx context.Context, id jobs.JobID, maxWait time.Duration,
) (jobs.State, bool) {
	w, ok := r.final.Register(strconv.FormatInt(int64(id), idBase))
	if !ok {
		return "", false
	}
	defer w.Release()
	timer := time.NewTimer(maxWait)
	defer timer.Stop()
	for {
		// Registered first, read second: a finish between the two cannot be missed.
		if st, done := r.terminal(ctx, id); done {
			return st, true
		}
		if !w.Await(ctx, timer.C) {
			return "", false
		}
	}
}

// terminal — the job's state, and whether it is final. A read error counts as not final.
func (r *runtime) terminal(ctx context.Context, id jobs.JobID) (jobs.State, bool) {
	j, err := r.Get(ctx, id)
	if err != nil || !j.State.Terminal() {
		return "", false
	}
	return j.State, true
}

// notifyFinal — every terminal state this process sees goes out as pg_notify, so waiters in
// any process wake. One path for local and remote waiters.
func (r *runtime) notifyFinal(
	ctx context.Context, events <-chan *river.Event, unsubscribe func(),
) {
	defer unsubscribe()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-events:
			if !ok {
				return
			}
			r.notifyOne(ctx, ev)
		}
	}
}

// notifyOne — sends one terminal event's job id on the final channel.
func (r *runtime) notifyOne(ctx context.Context, ev *river.Event) {
	if ev.Job == nil {
		return
	}
	id := strconv.FormatInt(ev.Job.ID, idBase)
	if err := pgstore.Notify(ctx, r.pool, finalChannel, id); err != nil && ctx.Err() == nil {
		r.log.Warn("jobs: notify final", "job", ev.Job.ID, "err", err)
	}
}
