package usecase_test

// Publishing a writing records writing.published in the same transaction as the switch: the event
// exists if and only if the writing went public (docs/design/event-bus-outbox-webhooks.md, *Two
// ways an event is born*).

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

// draft —— one owner with one draft writing, and deps whose recorder knows the given types.
type draft struct {
	pool      *pgxpool.Pool
	deps      usecase.WritingsDeps
	owner, id string
}

func draftWriting(t *testing.T, types []events.Type) *draft {
	t.Helper()
	ctx := context.Background()
	d := &draft{pool: scratchDB(t)}
	if err := d.pool.QueryRow(ctx, `INSERT INTO owners
		(email, password_hash, handle, full_name) VALUES ('o@example.com', 'x', 'o', 'O')
		RETURNING id`).Scan(&d.owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	writings := repo.NewWritingRepo(d.pool)
	w, err := writings.Create(ctx, &repo.CreateWritingInput{
		OwnerID: d.owner, Slug: "hello", Title: "Hello", BodyMD: "body",
	})
	if err != nil {
		t.Fatalf("seed writing: %v", err)
	}
	bus, err := events.New(d.pool, types, nil)
	if err != nil {
		t.Fatal(err)
	}
	d.deps, d.id = usecase.WritingsDeps{Writings: writings, Events: bus.Recorder()}, w.ID()
	return d
}

func (d *draft) published(t *testing.T) bool {
	t.Helper()
	var pub bool
	const q = `SELECT published_at IS NOT NULL FROM corpus_notes WHERE id = $1`
	if err := d.pool.QueryRow(context.Background(), q, d.id).Scan(&pub); err != nil {
		t.Fatal(err)
	}
	return pub
}

func (d *draft) publishedEvents(t *testing.T) int {
	t.Helper()
	var n int
	if err := d.pool.QueryRow(context.Background(), `SELECT count(*) FROM events
		WHERE type = 'writing.published' AND subject = $1 AND data->>'writing_id' = $2`,
		"writing/"+d.id, d.id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestPublishWriting_eventCommitsWithTheSwitch(t *testing.T) {
	t.Parallel()
	d := draftWriting(t, usecase.WritingEventTypes())
	if _, err := usecase.PublishWriting(context.Background(), d.deps, d.owner, d.id); err != nil {
		t.Fatal(err)
	}
	if pub, n := d.published(t), d.publishedEvents(t); !pub || n != 1 {
		t.Errorf("want published with one writing.published, got published=%v events=%d", pub, n)
	}
}

func TestPublishWriting_noEventNoPublish(t *testing.T) {
	t.Parallel()
	d := draftWriting(t, []events.Type{})
	if _, err := usecase.PublishWriting(context.Background(), d.deps, d.owner, d.id); err == nil {
		t.Fatal("recording failed, so publishing must fail")
	}
	if d.published(t) {
		t.Error("the publish must roll back with its event")
	}
}
