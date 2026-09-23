package admin

import (
	"context"
	"testing"
	"time"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// blockingIndexer — a fake corpus.Indexer whose ReindexOwner blocks until released. It lets the
// test prove the post-sync reindex is DISPATCHED but not WAITED ON (off the request's critical
// path): if reindexAsync ever runs the rebuild inline, the caller blocks here and the test fails.
type blockingIndexer struct {
	started chan struct{}
	release chan struct{}
}

func (*blockingIndexer) IndexNote(context.Context, string, string) {}
func (*blockingIndexer) DeleteNote(context.Context, string)        {}
func (*blockingIndexer) Reconcile(context.Context, string)         {}
func (b *blockingIndexer) ReindexOwner(context.Context, string) {
	close(b.started)
	<-b.release
}

// The full Meili rebuild after a vault sync must run OFF the request path — inline it exceeded the
// 30s http write timeout. reindexAsync dispatches it in the background; this guards that it returns
// promptly even while the rebuild itself is still running, AND that it really fired the rebuild.
func TestReindexAsyncIsOffTheRequestPath(t *testing.T) {
	t.Parallel()
	b := &blockingIndexer{started: make(chan struct{}), release: make(chan struct{})}
	defer close(b.release) // let the background goroutine finish after the assertions
	d := &ObsidianDeps{Corpus: corpus.Deps{Index: b}}

	returned := make(chan struct{})
	go func() {
		d.reindexAsync(context.Background(), "owner-1")
		close(returned)
	}()

	select {
	case <-returned:
	case <-time.After(2 * time.Second):
		t.Fatal("reindexAsync blocked on the reindex — it is still on the request's critical path")
	}

	select {
	case <-b.started:
	case <-time.After(2 * time.Second):
		t.Fatal("reindexAsync returned but never dispatched the reindex")
	}
}
