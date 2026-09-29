// worker.go — the one River worker, and the raw-JSON args type that lets every declared kind be
// a plain string on River.

package river

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"slices"
	"sync"
	"time"

	"github.com/riverqueue/river"

	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

var (
	aliasMu sync.RWMutex
	// River reads KindAliases off the zero value at registration.
	aliases []string
)

func declareAliases(names []string) {
	aliasMu.Lock()
	defer aliasMu.Unlock()
	for _, n := range names {
		if !slices.Contains(aliases, n) {
			aliases = append(aliases, n)
		}
	}
}

// rawArgs — any declared kind's args, carried as raw JSON. Kind() is the declared name at insert
// time; KindAliases() lists every declared name, so River routes each to the one worker.
type rawArgs struct {
	kind string
	raw  json.RawMessage
}

func (a rawArgs) Kind() string {
	if a.kind == "" {
		return primaryKind
	}
	return a.kind
}

func (rawArgs) KindAliases() []string {
	aliasMu.RLock()
	defer aliasMu.RUnlock()
	return slices.Clone(aliases)
}

func (a rawArgs) MarshalJSON() ([]byte, error) {
	if len(a.raw) == 0 {
		return []byte("{}"), nil
	}
	return a.raw, nil
}

// UnmarshalJSON — accepts any JSON. River decodes each job's args into a rawArgs before Work;
// Work reads job.EncodedArgs, never the decoded value, so there is nothing to keep.
func (*rawArgs) UnmarshalJSON([]byte) error { return nil }

// worker — dispatches by kind and translates the handler's failure class into River's.
type worker struct {
	river.WorkerDefaults[rawArgs]

	kinds map[string]jobs.Kind
}

func (w *worker) Work(ctx context.Context, job *river.Job[rawArgs]) error {
	k, ok := w.kinds[job.Kind]
	if !ok {
		//nolint:wrapcheck // River's control error; River records the cause's own message
		return river.JobCancel(fmt.Errorf("%w: %s", jobs.ErrUnknownKind, job.Kind))
	}
	err := k.Handle(ctx, json.RawMessage(job.EncodedArgs))
	if d, snoozed := jobs.SnoozeOf(err); snoozed {
		return river.JobSnooze(d) //nolint:wrapcheck // River's control error
	}
	if jobs.IsDiscard(err) {
		return river.JobCancel(err) //nolint:wrapcheck // River's control error
	}
	return err //nolint:wrapcheck // the handler's own error is the attempt's recorded error
}

func (w *worker) Timeout(job *river.Job[rawArgs]) time.Duration {
	return w.kinds[job.Kind].Timeout
}

func (w *worker) NextRetry(job *river.Job[rawArgs]) time.Time {
	backoff := w.kinds[job.Kind].Backoff
	if backoff == nil {
		backoff = jobs.DefaultBackoff
	}
	d := backoff(job.Attempt)
	if span := int64(d) / jitterFraction; span > 0 {
		d += time.Duration(rand.Int64N(2*span) - span) //nolint:gosec // jitter, not security
	}
	return time.Now().Add(d)
}
