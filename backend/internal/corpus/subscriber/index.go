// Package subscriber — what the corpus domain does in response to events: declared as data,
// collected generically by the composition root, run as durable jobs.
//
// This layer may use usecase and repo; nothing below may import it (check-domain-layering).
package subscriber

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/jobs"
)

// NoteChanged — the trigger-written event for every corpus_notes change.
const NoteChanged = "corpus.note.changed"

// IndexSubscriber — the subscription (and job kind) that carries corpus changes to Meili.
const IndexSubscriber = "corpus.index"

// ReindexKind — the job kind that rebuilds an owner's whole index (enqueued at boot).
const ReindexKind = "corpus.reindex"

const (
	indexMaxAttempts = 10
	indexTimeout     = 30 * time.Second
	reindexTimeout   = 10 * time.Minute
	receiptWait      = 2 * time.Second
)

// EventTypes — the event types this domain owns.
func EventTypes() []events.Type {
	return []events.Type{{
		Type:        NoteChanged,
		Description: "A corpus note was created, updated or deleted (data.op).",
		Subject:     "<genre>://<note path>",
		Exposure:    events.Webhook,
	}}
}

// noteData — the fixed payload the corpus_notes trigger writes.
type noteData struct {
	Op          string `json:"op"`
	NoteID      string `json:"note_id"`
	PathChanged bool   `json:"path_changed"`
}

// Subscriptions — nil indexer (Meili not configured) → none.
func Subscriptions(ix usecase.Indexer) []events.Subscription {
	if ix == nil {
		return []events.Subscription{}
	}
	return []events.Subscription{{
		Name: IndexSubscriber, Types: []string{NoteChanged},
		Queue: jobs.QueueIndex, MaxAttempts: indexMaxAttempts, Timeout: indexTimeout,
		// The handler re-reads the note's current state, so the latest change of a note in a batch
		// covers the earlier ones (a 2,000-note import stays one job per note).
		Coalesce: true,
		Handle: func(ctx context.Context, ev events.Event) error {
			return indexEvent(ctx, ix, &ev)
		},
	}}
}

// indexEvent — idempotent: it reads the note's current state, so running it twice (or after a
// later change) indexes the same thing.
func indexEvent(ctx context.Context, ix usecase.Indexer, ev *events.Event) error {
	var d noteData
	if err := json.Unmarshal(ev.Data, &d); err != nil || d.NoteID == "" {
		return jobs.Discard(fmt.Errorf("corpus.index: unreadable event data %s", ev.Data))
	}
	return applyNoteChange(ctx, ix, ev.OwnerID, &d)
}

// applyNoteChange — the index write one note change calls for. The Indexer's errors already name
// their step; each is the job attempt's recorded error, so it is returned as is.
func applyNoteChange(ctx context.Context, ix usecase.Indexer, ownerID string, d *noteData) error {
	switch {
	case d.Op == "deleted":
		return ix.DeleteNote(ctx, d.NoteID)
	case d.PathChanged:
		return ix.IndexSubtree(ctx, ownerID, d.NoteID)
	default:
		return ix.IndexNote(ctx, ownerID, d.NoteID)
	}
}

type reindexArgs struct {
	OwnerID string `json:"owner_id"`
}

// Kinds — this domain's own job kinds (besides subscriptions).
func Kinds(ix usecase.Indexer) []jobs.Kind {
	if ix == nil {
		return []jobs.Kind{}
	}
	return []jobs.Kind{{
		Name: ReindexKind, Queue: jobs.QueueIndex,
		MaxAttempts: indexMaxAttempts, Timeout: reindexTimeout,
		Handle: func(ctx context.Context, raw json.RawMessage) error {
			var a reindexArgs
			if err := json.Unmarshal(raw, &a); err != nil || a.OwnerID == "" {
				return jobs.Discard(fmt.Errorf("corpus.reindex: bad args %s", raw))
			}
			return ix.ReindexOwner(ctx, a.OwnerID)
		},
	}}
}

// EnqueueReindex — enqueues the full rebuild for the instance's owner (boot, or the panel's
// one-click rebuild). An unclaimed instance has nothing to rebuild.
func EnqueueReindex(
	ctx context.Context, j jobs.Jobs, soleOwner usecase.SoleOwnerID,
) (jobs.JobID, error) {
	owner, err := soleOwner(ctx)
	if err != nil || owner == "" {
		return 0, err
	}
	args := reindexArgs{OwnerID: owner}
	return j.Enqueue(ctx, ReindexKind, args, jobs.EnqueueOpts{})
}

// Receipt — the IndexReceipt the corpus write ops hand back.
type Receipt struct {
	bus  *events.Bus
	jobs jobs.Runtime
}

// NewReceipt — nil indexer (Meili not configured) → nil: writes carry no index receipt.
func NewReceipt(ix usecase.Indexer, bus *events.Bus, rt jobs.Runtime) usecase.IndexReceipt {
	if ix == nil {
		return nil
	}
	return &Receipt{bus: bus, jobs: rt}
}

// Await — waits up to 2 s for the note's latest change to reach the index.
func (r *Receipt) Await(ctx context.Context, noteID string) (bool, int64) {
	deadline := time.Now().Add(receiptWait)
	evID, err := r.bus.LatestFor(ctx, NoteChanged, "note_id", noteID)
	if err != nil || evID == "" {
		return false, 0
	}
	job, ok := r.bus.AwaitFanout(ctx, evID, IndexSubscriber, time.Until(deadline))
	if !ok {
		return false, 0
	}
	st, done := r.jobs.Wait(ctx, job, time.Until(deadline))
	return done && st == jobs.StateCompleted, int64(job)
}
