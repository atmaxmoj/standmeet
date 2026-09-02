// Package search — the Meilisearch wrapper for corpus lexical search (1b crawl face).
//
// Postgres is the source of truth; meili is a derived projection: the write path
// upserts/deletes in sync (see index propagation in usecases), the read path goes through
// Search. Every write WaitForTask's, so "written = immediately searchable" holds as strong
// consistency (no polling, no e2e flakiness). ACL doesn't live at this layer — this layer only
// filters by owner_id; fine-grained path-glob ACL is applied row-by-row by the caller
// (pgCorpusLister), reusing the existing allowsCorpusURI so admission matches corpus_read
// exactly.
package search

import (
	"context"
	"fmt"
	"time"

	"github.com/meilisearch/meilisearch-go"
)

const (
	corpusIndex  = "corpus_notes"
	waitInterval = 20 * time.Millisecond
	// defaultLimit — the cap on what one Search call pulls from meili (the candidate
	// pool before ACL filtering).
	defaultLimit = 100
)

// Doc — the shape of one corpus note in the meili index. id = corpus_notes.id (raw
// uses the raw id). searchable: title/body/tags; filterable: owner_id/genre/published.
type Doc struct {
	ID        string   `json:"id"`
	OwnerID   string   `json:"owner_id"`
	Genre     string   `json:"genre"`
	Path      string   `json:"path"`
	Title     string   `json:"title"`
	Body      string   `json:"body"`
	ParentID  string   `json:"parent_id"`
	Tags      []string `json:"tags"`
	Published bool     `json:"published"`
}

// Client — the meili wrapper. Search/Index/Delete all WaitForTask for strong consistency.
type Client struct {
	mgr   meilisearch.ServiceManager
	index meilisearch.IndexManager
}

// New — builds the client. Empty host/key → returns nil (caller checks nil and falls
// back to Postgres full-text search).
func New(host, apiKey string) *Client {
	if host == "" {
		return nil
	}
	mgr := meilisearch.New(host, meilisearch.WithAPIKey(apiKey))
	return &Client{mgr: mgr, index: mgr.Index(corpusIndex)}
}

// EnsureIndex — creates the index (primaryKey=id) + configures searchable/filterable
// attributes. Called once at startup; idempotent (CreateIndex errors harmlessly when the
// index already exists, so that error is ignored).
func (c *Client) EnsureIndex(ctx context.Context) error {
	idxCfg := &meilisearch.IndexConfig{Uid: corpusIndex, PrimaryKey: "id"}
	if _, err := c.mgr.CreateIndexWithContext(ctx, idxCfg); err != nil {
		_ = err // already-exists and the like → harmless
	}
	searchable := []string{"title", "body", "tags"}
	if _, err := c.index.UpdateSearchableAttributesWithContext(ctx, &searchable); err != nil {
		return fmt.Errorf("meili searchable attrs: %w", err)
	}
	filterable := []any{"owner_id", "genre", "published"}
	task, err := c.index.UpdateFilterableAttributesWithContext(ctx, &filterable)
	if err != nil {
		return fmt.Errorf("meili filterable attrs: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// Index — upserts a batch of docs (primaryKey=id → same id overwrites). WaitForTask
// after writing.
func (c *Client) Index(ctx context.Context, docs []Doc) error {
	if len(docs) == 0 {
		return nil
	}
	pk := "id"
	opts := &meilisearch.DocumentOptions{PrimaryKey: &pk}
	task, err := c.index.AddDocumentsWithContext(ctx, docs, opts)
	if err != nil {
		return fmt.Errorf("meili add docs: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// Delete — removes docs by id (when a note is deleted/archived).
func (c *Client) Delete(ctx context.Context, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	task, err := c.index.DeleteDocumentsWithContext(ctx, ids, nil)
	if err != nil {
		return fmt.Errorf("meili delete docs: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// DeleteOwner — clears every doc for one owner (cleared before a reindex backfill, to
// prevent stale drift from sticking around).
func (c *Client) DeleteOwner(ctx context.Context, ownerID string) error {
	filter := fmt.Sprintf("owner_id = %q", ownerID)
	task, err := c.index.DeleteDocumentsByFilterWithContext(ctx, filter, nil)
	if err != nil {
		return fmt.Errorf("meili delete owner: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// Search — lexical search over one owner's corpus. Filters only by owner_id;
// fine-grained ACL (glob/published) is applied row-by-row by the caller. Returns the hit
// Docs (with path/genre so the caller can judge ACL and build CorpusMeta).
func (c *Client) Search(ctx context.Context, ownerID, query string) ([]Doc, error) {
	resp, err := c.index.SearchWithContext(ctx, query, &meilisearch.SearchRequest{
		Filter: fmt.Sprintf("owner_id = %q", ownerID),
		Limit:  defaultLimit,
		// frequency (not default "last"): a query like "tell me about X" keeps the high-signal
		// term instead of dropping it off the end, so the topic matches.
		MatchingStrategy: "frequency",
	})
	if err != nil {
		return nil, fmt.Errorf("meili search: %w", err)
	}
	out := make([]Doc, 0, len(resp.Hits))
	if derr := resp.Hits.DecodeInto(&out); derr != nil {
		return nil, fmt.Errorf("meili decode hits: %w", derr)
	}
	return out, nil
}

// Healthy — a live health ping. err != nil = degraded (used for the admin panel
// display and by reconcile's decision).
func (c *Client) Healthy(ctx context.Context) error {
	if _, err := c.mgr.HealthWithContext(ctx); err != nil {
		return fmt.Errorf("meili health: %w", err)
	}
	return nil
}

func (c *Client) wait(ctx context.Context, taskUID int64) error {
	task, err := c.index.WaitForTaskWithContext(ctx, taskUID, waitInterval)
	if err != nil {
		return fmt.Errorf("meili wait task %d: %w", taskUID, err)
	}
	if task.Status != meilisearch.TaskStatusSucceeded {
		return fmt.Errorf("meili task %d not succeeded: %s", taskUID, task.Status)
	}
	return nil
}
