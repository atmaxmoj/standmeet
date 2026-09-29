// worker.go — the one River worker, and the raw-JSON args type that lets every declared kind be
// a plain string on River.

package river

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
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
		return river.JobCancel(fmt.Errorf("%w: %s", jobs.ErrUnknownKind, job.Kind))
	}
	err := k.Handle(ctx, json.RawMessage(job.EncodedArgs))
	if d, snoozed := jobs.SnoozeOf(err); snoozed {
		return river.JobSnooze(d)
	}
	if jobs.IsDiscard(err) {
		return river.JobCancel(err)
	}
	return err
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
	return time.Now().Add(d + jitter(int64(d)/jitterFraction))
}

// jitter —— a uniform offset in [-span, span). crypto/rand reads the system source; it does not
// fail on the platforms we run, and if it ever did the retry would simply go without jitter.
func jitter(span int64) time.Duration {
	if span <= 0 {
		return 0
	}
	n, err := rand.Int(rand.Reader, big.NewInt(2*span))
	if err != nil {
		return 0
	}
	return time.Duration(n.Int64() - span)
}
