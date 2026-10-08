// Package search — the Meilisearch wrapper for corpus lexical search (1b crawl face).
//
// Postgres is the source of truth; meili is a derived projection: the index jobs upsert/delete,
// the read path goes through Search. Every write WaitForTask's, so "written = immediately
// searchable" holds as strong consistency (no polling, no e2e flakiness).
//
// One document per (note, language face, heading section) — a chunk — not one per note: a long
// note's matching section is what a hit carries, and an English query is answered from English
// faces first. Search collapses chunks back to notes for its callers.
//
// Scope: the caller passes a filter expression (built from the visitor's ACL) that runs INSIDE
// Meili, so the result limit applies to what the caller may read; the caller still checks every
// row against the exact glob ACL (the filter is a superset).
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
	// defaultLimit — chunks pulled per pass, after the scope filter.
	defaultLimit = 100
)

// Doc — one chunk. ID = NoteID + lang + section index. URI is the note's corpus URI;
// URIPrefixes are its ancestor URIs (genre root included), the handle a scope filter matches on.
type Doc struct {
	ID          string   `json:"id"`
	NoteID      string   `json:"note_id"`
	OwnerID     string   `json:"owner_id"`
	Genre       string   `json:"genre"`
	Path        string   `json:"path"`
	URI         string   `json:"uri"`
	URIPrefixes []string `json:"uri_prefixes"`
	Lang        string   `json:"lang"`
	Title       string   `json:"title"`
	Aliases     []string `json:"aliases"`
	Heading     string   `json:"heading"`
	Body        string   `json:"body"`
	ParentID    string   `json:"parent_id"`
	Tags        []string `json:"tags"`
	Published   bool     `json:"published"`
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
	// No client-side retries: index writes run as jobs, and the job layer is their one retry
	// owner; a search a visitor waits on is sent once (docs/design/event-bus-outbox-webhooks.md,
	// *Retry*). The library's default retried 502/503/504 underneath both.
	mgr := meilisearch.New(host, meilisearch.WithAPIKey(apiKey), meilisearch.DisableRetries())
	return &Client{mgr: mgr, index: mgr.Index(corpusIndex)}
}

// EnsureIndex — creates the index (primaryKey=id) + configures searchable/filterable
// attributes. Called once at startup; idempotent (CreateIndex errors harmlessly when the
// index already exists, so that error is ignored). The searchable order is the ranking order.
func (c *Client) EnsureIndex(ctx context.Context) error {
	idxCfg := &meilisearch.IndexConfig{Uid: corpusIndex, PrimaryKey: "id"}
	if _, err := c.mgr.CreateIndexWithContext(ctx, idxCfg); err != nil {
		_ = err // already-exists and the like → harmless
	}
	searchable := []string{"title", "aliases", "heading", "body", "tags"}
	if _, err := c.index.UpdateSearchableAttributesWithContext(ctx, &searchable); err != nil {
		return fmt.Errorf("meili searchable attrs: %w", err)
	}
	filterable := []any{"owner_id", "note_id", "genre", "published", "lang", "uri", "uri_prefixes"}
	task, err := c.index.UpdateFilterableAttributesWithContext(ctx, &filterable)
	if err != nil {
		return fmt.Errorf("meili filterable attrs: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// ReplaceNotes —— drops every chunk of these notes, then writes docs: a note re-chunked into
// fewer sections must not keep its old tail.
func (c *Client) ReplaceNotes(ctx context.Context, noteIDs []string, docs []Doc) error {
	if err := c.DeleteNotes(ctx, noteIDs); err != nil {
		return err
	}
	return c.Index(ctx, docs)
}

// Index — upserts a batch of docs (primaryKey=id → same id overwrites). WaitForTask
// after writing.
func (c *Client) Index(ctx context.Context, docs []Doc) error {
	if len(docs) == 0 {
		return nil
	}
	pk := "id"
	opts := &meilisearch.DocumentOptions{PrimaryKey: &pk}
	// A fresh index handle per call: the client stores the primary key option on the handle it
	// is given, so the index workers sharing c.index raced on it.
	task, err := c.mgr.Index(corpusIndex).AddDocumentsWithContext(ctx, docs, opts)
	if err != nil {
		return fmt.Errorf("meili add docs: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// DeleteNotes — removes every chunk of these notes.
func (c *Client) DeleteNotes(ctx context.Context, noteIDs []string) error {
	if len(noteIDs) == 0 {
		return nil
	}
	task, err := c.index.DeleteDocumentsByFilterWithContext(ctx, InFilter("note_id", noteIDs), nil)
	if err != nil {
		return fmt.Errorf("meili delete notes: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// DeleteOwner — clears every doc for one owner (cleared before a reindex backfill, to
// prevent stale drift — including documents in an older index shape — from sticking around).
func (c *Client) DeleteOwner(ctx context.Context, ownerID string) error {
	task, err := c.index.DeleteDocumentsByFilterWithContext(ctx, Eq("owner_id", ownerID), nil)
	if err != nil {
		return fmt.Errorf("meili delete owner: %w", err)
	}
	return c.wait(ctx, task.TaskUID)
}

// Search — lexical search over one owner's corpus, inside scope (a filter expression; "" = the
// whole owner). Two passes: chunks in the query's language first, then the rest; the chunks
// collapse to one Doc per note, in rank order.
func (c *Client) Search(ctx context.Context, ownerID, scope, query string) ([]Doc, error) {
	base := Eq("owner_id", ownerID)
	if scope != "" {
		base += " AND (" + scope + ")"
	}
	lang := QueryLang(query)
	first, err := c.pass(ctx, query, base+" AND "+Eq("lang", lang))
	if err != nil {
		return nil, err
	}
	rest, err := c.pass(ctx, query, base+" AND "+Ne("lang", lang))
	if err != nil {
		return nil, err
	}
	return collapse(append(first, rest...)), nil
}

// Healthy — a live health ping. err != nil = degraded (used for the admin panel
// display and by reconcile's decision).
func (c *Client) Healthy(ctx context.Context) error {
	if _, err := c.mgr.HealthWithContext(ctx); err != nil {
		return fmt.Errorf("meili health: %w", err)
	}
	return nil
}

// pass —— one filtered query.
func (c *Client) pass(ctx context.Context, query, filter string) ([]Doc, error) {
	resp, err := c.index.SearchWithContext(ctx, query, &meilisearch.SearchRequest{
		Filter: filter,
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

// collapse —— the best-ranked chunk of each note, in rank order.
func collapse(docs []Doc) []Doc {
	seen := make(map[string]bool, len(docs))
	out := make([]Doc, 0, len(docs))
	for i := range docs {
		if seen[docs[i].NoteID] {
			continue
		}
		seen[docs[i].NoteID] = true
		out = append(out, docs[i])
	}
	return out
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
