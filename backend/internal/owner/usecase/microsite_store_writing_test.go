package usecase_test

// A page's store as a shared manuscript (docs/design/scenario-s2-collaborative-writing.md): the
// host stamps who wrote a document and when, a client cannot write host keys, the owner's policy
// sets the limit and whether a new document waits for approval, and a search finds published text.

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

const (
	novelSlug    = "novel"
	passages     = "passages"
	defaultLimit = 500
)

// memDocs —— an in-memory MicrositeDocStore: the use case's rules are under test, not blockstore.
type memDocs struct {
	docs []entity.MicrositeDocument
	mu   sync.Mutex
	seq  int
}

func (*memDocs) Provision(context.Context, string) error { return nil }
func (m *memDocs) Drop(context.Context, string) error    { m.docs = nil; return nil }

func (m *memDocs) Insert(
	_ context.Context, _ pgstore.Tx, _, collection string, doc json.RawMessage,
) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq++
	id := "d" + strconv.Itoa(m.seq)
	m.docs = append(m.docs, entity.MicrositeDocument{
		ID: id, Collection: collection, Doc: doc, CreatedAt: time.Now(),
	})
	return id, nil
}

func (m *memDocs) Query(
	_ context.Context, _, collection string, _ json.RawMessage,
) ([]json.RawMessage, error) {
	out := []json.RawMessage{}
	for _, d := range m.docs {
		if d.Collection == collection {
			out = append(out, d.Doc)
		}
	}
	return out, nil
}

func (m *memDocs) QueryRecords(
	_ context.Context, _, collection string,
) ([]entity.MicrositeDocument, error) {
	return slices.DeleteFunc(slices.Clone(m.docs), func(d entity.MicrositeDocument) bool {
		return d.Collection != collection
	}), nil
}

func (m *memDocs) CountAll(context.Context, string) (int64, error) {
	return int64(len(m.docs)), nil
}

func (m *memDocs) RecordsPage(
	context.Context, string, *paging.Cursor, int32,
) ([]entity.MicrositeDocument, error) {
	out := slices.Clone(m.docs)
	slices.Reverse(out)
	return out, nil
}

func (m *memDocs) DeleteByID(_ context.Context, _ pgstore.Tx, _, _, id string) error {
	m.docs = slices.DeleteFunc(m.docs, func(d entity.MicrositeDocument) bool { return d.ID == id })
	return nil
}

func (m *memDocs) Patch(_ context.Context, _ pgstore.Tx, p usecase.DocPatch) error {
	i := slices.IndexFunc(m.docs, func(d entity.MicrositeDocument) bool {
		return d.ID == p.RecordID
	})
	if i < 0 {
		return entity.ErrMicrositeNotFound
	}
	merged, err := mergeKeys(m.docs[i].Doc, p.Patch)
	if err != nil {
		return err
	}
	m.docs[i].Doc = merged
	return nil
}

// mergeKeys —— doc || patch, as jsonb does it.
func mergeKeys(doc, patch json.RawMessage) (json.RawMessage, error) {
	var d, p map[string]json.RawMessage
	if err := json.Unmarshal(doc, &d); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(patch, &p); err != nil {
		return nil, err
	}
	maps.Copy(d, p)
	return json.Marshal(d)
}

type writingFixture struct {
	deps  usecase.MicrositeDeps
	owner string
}

func writingSetup(t *testing.T) *writingFixture {
	t.Helper()
	pool := scratchDB(t)
	bus, err := events.New(pool,
		append(usecase.MicrositeEventTypes(), usecase.OwnerEventTypes()...), nil)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	var owner string
	if err = pool.QueryRow(ctx, `INSERT INTO owners (email, password_hash, handle, full_name)
		VALUES ('n@example.com', 'x', 'novel', 'N') RETURNING id`).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	pages := repo.NewMicrositeRepo(pool)
	if _, err = pages.Create(ctx, owner, novelSlug, "Novel"); err != nil {
		t.Fatal(err)
	}
	if err = pages.SetStoreWritable(ctx, owner, novelSlug, true); err != nil {
		t.Fatal(err)
	}
	rec := bus.Recorder()
	return &writingFixture{owner: owner, deps: usecase.MicrositeDeps{
		Pages: pages, Docs: &memDocs{}, Events: func() events.Recorder { return rec },
	}}
}

var ana = entity.DocAuthor{Kind: entity.AuthorMember, Name: "Ana", MemberID: "m-ana"}

// insert —— one write by Ana; the use case's answer as is.
func (f *writingFixture) insert(doc string) (usecase.InsertedDoc, error) {
	return usecase.VisitorInsert(context.Background(), f.deps, f.owner, &usecase.DocWrite{
		Slug: novelSlug, Collection: passages, Doc: json.RawMessage(doc), Author: ana,
	})
}

func (f *writingFixture) write(t *testing.T, text string) usecase.InsertedDoc {
	t.Helper()
	got, err := f.insert(`{"text":"` + text + `"}`)
	if err != nil {
		t.Fatalf("write %q: %v", text, err)
	}
	return got
}

func (f *writingFixture) policy(t *testing.T, c usecase.StorePolicyChange) {
	t.Helper()
	if _, err := usecase.OwnerSetStorePolicy(context.Background(), f.deps, f.owner, novelSlug,
		c); err != nil {
		t.Fatal(err)
	}
}

// readDoc —— what a visitor reads back of one document.
type readDoc struct {
	ID        string           `json:"_id"`
	Text      string           `json:"text"`
	CreatedAt string           `json:"_created_at"`
	Author    entity.DocAuthor `json:"_author"`
}

func (f *writingFixture) read(t *testing.T) []readDoc {
	t.Helper()
	docs, err := usecase.VisitorQuery(context.Background(), f.deps, f.owner,
		usecase.DocQuery{Slug: novelSlug, Collection: passages})
	if err != nil {
		t.Fatal(err)
	}
	out := make([]readDoc, 0, len(docs))
	for _, d := range docs {
		var r readDoc
		if err = json.Unmarshal(d, &r); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

// TestStore_ClientCannotWriteHostKeys — a document may not carry a top-level `_` key: those are
// the host's (author, status, time), and a client that could write them could sign as anyone.
func TestStore_ClientCannotWriteHostKeys(t *testing.T) {
	t.Parallel()
	f := writingSetup(t)
	_, err := f.insert(`{"text":"x","_author":{"name":"Owner"}}`)
	if !errors.Is(err, usecase.ErrMicrositeStoreInvalid) {
		t.Fatalf("a client `_author` was accepted: %v", err)
	}
}

// TestStore_WriteIsStampedWithItsAuthor — the reader gets the id, the author and the time.
func TestStore_WriteIsStampedWithItsAuthor(t *testing.T) {
	t.Parallel()
	f := writingSetup(t)
	id := f.write(t, "the ledger").ID
	docs := f.read(t)
	if len(docs) != 1 {
		t.Fatalf("read %d docs, want 1", len(docs))
	}
	if d := docs[0]; d.ID != id || d.Author.Name != "Ana" || d.CreatedAt == "" {
		t.Fatalf("not stamped: %+v", d)
	}
}

// TestStore_ReviewHoldsANewDocumentUntilApproved — with review on, a new document is pending: the
// writer is told, visitors do not see it, the owner approves it and then they do.
func TestStore_ReviewHoldsANewDocumentUntilApproved(t *testing.T) {
	t.Parallel()
	f := writingSetup(t)
	on := true
	f.policy(t, usecase.StorePolicyChange{Review: &on})
	got := f.write(t, "waits")
	if !got.Pending || len(f.read(t)) != 0 {
		t.Fatalf("pending=%v, visitors see %d documents", got.Pending, len(f.read(t)))
	}
	ref := usecase.DocRef{Slug: novelSlug, Collection: passages, RecordID: got.ID}
	if err := usecase.OwnerApproveDoc(context.Background(), f.deps, f.owner, ref); err != nil {
		t.Fatal(err)
	}
	if n := len(f.read(t)); n != 1 {
		t.Fatalf("after approval visitors see %d documents, want 1", n)
	}
}

// TestStore_TheDefaultLimitIs500 — a page whose owner set nothing holds 500 documents.
func TestStore_TheDefaultLimitIs500(t *testing.T) {
	t.Parallel()
	f := writingSetup(t)
	p, err := usecase.OwnerStorePolicy(context.Background(), f.deps, f.owner, novelSlug)
	if err != nil || p.MaxDocs != defaultLimit || p.Review {
		t.Fatalf("default policy %+v (%v), want 500 and no review", p, err)
	}
}

// TestStore_TheLimitIsTheOwners — the page holds at most the owner's max_docs; 0 is refused.
func TestStore_TheLimitIsTheOwners(t *testing.T) {
	t.Parallel()
	f := writingSetup(t)
	one := int32(1)
	f.policy(t, usecase.StorePolicyChange{MaxDocs: &one})
	f.write(t, "first")
	if _, err := f.insert(`{"text":"second"}`); !errors.Is(err, entity.ErrMicrositeStoreQuota) {
		t.Fatalf("a write over the owner's limit: %v", err)
	}
	zero := int32(0)
	if _, err := usecase.OwnerSetStorePolicy(context.Background(), f.deps, f.owner, novelSlug,
		usecase.StorePolicyChange{MaxDocs: &zero}); err == nil {
		t.Fatal("a limit of 0 was accepted")
	}
}

// TestStore_SearchFindsPublishedText — the agent's search matches text, never a pending document.
func TestStore_SearchFindsPublishedText(t *testing.T) {
	t.Parallel()
	f := writingSetup(t)
	f.write(t, "The master kept a ledger")
	f.write(t, "Nothing about it")
	on := true
	f.policy(t, usecase.StorePolicyChange{Review: &on})
	f.write(t, "A pending ledger line")
	hits, err := usecase.SearchDocs(context.Background(), f.deps, f.owner, usecase.DocSearch{
		DocQuery: usecase.DocQuery{Slug: novelSlug, Collection: passages}, Query: "LEDGER",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(hits) != 1 || !strings.Contains(string(hits[0]), "The master kept a ledger") {
		t.Fatalf("search hits: %s", hits)
	}
}
