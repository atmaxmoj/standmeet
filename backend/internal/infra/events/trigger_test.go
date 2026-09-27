package events_test

// The corpus_notes trigger: every write path emits, because the database writes the event —
// no call site can forget it. Assertions are on the exact event sequence up to a sentinel, so an
// empty or broken outbox cannot pass.

import (
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

const (
	genreWiki     = "wiki"
	watchedEvents = 9 // created + 8 updates
	wakeWait      = 3 * time.Second
	// parentMoveEvent — the index of the parent change: after two creates, a body and a title edit.
	parentMoveEvent = 4
)

type noteData struct {
	Op           string `json:"op"`
	NoteID       string `json:"note_id"`
	Genre        string `json:"genre"`
	ParentID     string `json:"parent_id"`
	Published    bool   `json:"published"`
	WasPublished bool   `json:"was_published"`
	PathChanged  bool   `json:"path_changed"`
}

type seen struct {
	subject string
	data    noteData
}

// trig — a scratch database with the bus's declarations and one seeded owner.
type trig struct {
	pool  *pgxpool.Pool
	owner string
}

func seedOwner(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var id string
	q := `INSERT INTO owners (email, password_hash, handle, full_name)
		VALUES ('o@example.com', 'x', 'o', 'O') RETURNING id`
	if err := pool.QueryRow(context.Background(), q).Scan(&id); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	return id
}

// insert — a note of the owner; an empty parent inserts a root note.
func (tr *trig) insert(t *testing.T, genre, title, parent string) string {
	t.Helper()
	var id string
	var p *string
	if parent != "" {
		p = &parent
	}
	q := `INSERT INTO corpus_notes (owner_id, genre, title, body, parent_id, slug)
		VALUES ($1, $2, $3, 'body', $4, $5) RETURNING id`
	row := tr.pool.QueryRow(context.Background(), q, tr.owner, genre, title, p, "s-"+title)
	if err := row.Scan(&id); err != nil {
		t.Fatalf("insert note: %v", err)
	}
	return id
}

// exec — one statement whose $1 is the note id.
func (tr *trig) exec(t *testing.T, sql, id string) {
	t.Helper()
	if _, err := tr.pool.Exec(context.Background(), sql, id); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// setParent — moves the note under parent.
func (tr *trig) setParent(t *testing.T, id, parent string) {
	t.Helper()
	q := `UPDATE corpus_notes SET parent_id = $2 WHERE id = $1`
	if _, err := tr.pool.Exec(context.Background(), q, id, parent); err != nil {
		t.Fatalf("%s: %v", q, err)
	}
}

// noteEvents — the corpus.note.changed events in commit order.
func (tr *trig) noteEvents(t *testing.T) []seen {
	t.Helper()
	q := `SELECT subject, data FROM events WHERE type = 'corpus.note.changed' ORDER BY seq`
	rows, err := tr.pool.Query(context.Background(), q)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []seen
	for rows.Next() {
		var s seen
		var raw []byte
		if err = rows.Scan(&s.subject, &raw); err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(raw, &s.data); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

func ops(ev []seen) []string {
	out := make([]string, 0, len(ev))
	for _, e := range ev {
		out = append(out, e.data.Op+" "+e.subject)
	}
	return out
}

func triggerRig(t *testing.T) *trig {
	t.Helper()
	pool := scratchDB(t)
	if _, err := events.New(pool, []events.Type{noteChanged}, nil); err != nil {
		t.Fatal(err)
	}
	return &trig{pool: pool, owner: seedOwner(t, pool)}
}

func TestInsertEmitsCreatedWithTheNotesURI(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	id := tr.insert(t, genreWiki, "Hello, World!", "")
	ev := tr.noteEvents(t)
	if len(ev) != 1 {
		t.Fatalf("events = %+v", ev)
	}
	got := []string{ev[0].subject, ev[0].data.Op, ev[0].data.NoteID, ev[0].data.Genre}
	if !slices.Equal(got, []string{"wiki://hello-world", "created", id, genreWiki}) {
		t.Fatalf("events = %+v", ev)
	}
}

//nolint:gosmopolitan // the Chinese title is the thing under test: a CJK segment in the URI path
func TestAChildsURIWalksItsParentChain(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	root := tr.insert(t, genreWiki, "Software", "")
	mid := tr.insert(t, genreWiki, "Project", root)
	tr.insert(t, genreWiki, "卢塞恩 项目", mid)
	ev := tr.noteEvents(t)
	if ev[2].subject != "wiki://software/project/卢塞恩-项目" {
		t.Fatalf("child subject = %q", ev[2].subject)
	}
}

func TestEveryWatchedColumnChangeEmitsUpdated(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	id := tr.insert(t, genreWiki, "Watch", "")
	for _, set := range []string{
		`body = 'b2'`, `title = 'Watch'`, `tags = '{x}'`, `published = true`,
		`show_as_source = false`, `aliases = '{al}'`, `excerpt = 'ex'`, `slug = 's2'`,
		`archived = true`,
	} {
		tr.exec(t, `UPDATE corpus_notes SET `+set+` WHERE id = $1`, id)
	}
	// title = 'Watch' is a no-op (same value) and must not emit; the other eight each emit once.
	got := ops(tr.noteEvents(t))
	if len(got) != watchedEvents || got[0] != "created wiki://watch" {
		t.Fatalf("events = %v, want created + 8 updates", got)
	}
}

func TestANoOpUpdateEmitsNothing(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	id := tr.insert(t, genreWiki, "Quiet", "")
	tr.exec(t, `UPDATE corpus_notes SET updated_at = now() + interval '1 minute' WHERE id = $1`, id)
	tr.exec(t, `UPDATE corpus_notes SET obsidian_imported_at = now() WHERE id = $1`, id)
	tr.insert(t, genreWiki, "Sentinel", "")
	got := ops(tr.noteEvents(t))
	if !slices.Equal(got, []string{"created wiki://quiet", "created wiki://sentinel"}) {
		t.Fatalf("events = %v", got)
	}
}

func TestPublishFlipCarriesBothFlags(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	id := tr.insert(t, genreWiki, "Pub", "")
	tr.exec(t, `UPDATE corpus_notes SET published = true WHERE id = $1`, id)
	tr.exec(t, `UPDATE corpus_notes SET published = false WHERE id = $1`, id)
	ev := tr.noteEvents(t)
	on, off := ev[1].data, ev[2].data
	if !on.Published || on.WasPublished || off.Published || !off.WasPublished {
		t.Fatalf("publish flags = %+v / %+v", on, off)
	}
}

func TestDeleteCarriesTheLastKnownSubject(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	root := tr.insert(t, genreWiki, "Docs", "")
	leaf := tr.insert(t, genreWiki, "Gone Soon", root)
	tr.exec(t, `DELETE FROM corpus_notes WHERE id = $1`, leaf)
	ev := tr.noteEvents(t)
	last := ev[len(ev)-1]
	if last.data.Op != "deleted" || last.subject != "wiki://docs/gone-soon" ||
		last.data.NoteID != leaf {
		t.Fatalf("delete event = %+v", last)
	}
}

func TestTitleOrParentChangeMarksThePathChanged(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	a := tr.insert(t, genreWiki, "A", "")
	n := tr.insert(t, genreWiki, "N", "")
	tr.exec(t, `UPDATE corpus_notes SET body = 'x' WHERE id = $1`, n)
	tr.exec(t, `UPDATE corpus_notes SET title = 'N2' WHERE id = $1`, n)
	tr.setParent(t, n, a)
	ev := tr.noteEvents(t)
	moved := ev[parentMoveEvent]
	body, title, parent := ev[2].data.PathChanged, ev[3].data.PathChanged, moved.data.PathChanged
	if body || !title || !parent || moved.subject != "wiki://a/n2" {
		t.Fatalf("path_changed = %v %v %v, subject %q", body, title, parent, moved.subject)
	}
}

func TestRawAndWritingURIs(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	raw := tr.insert(t, "raw", "", "")
	tr.insert(t, "writing", "Essay", "")
	ev := tr.noteEvents(t)
	if ev[0].subject != "raw://"+raw || ev[1].subject != "writing://writings/s-Essay" {
		t.Fatalf("subjects = %q, %q", ev[0].subject, ev[1].subject)
	}
}

func TestTheTriggerWakesTheRelay(t *testing.T) {
	t.Parallel()
	tr := triggerRig(t)
	ctx := context.Background()
	conn, err := tr.pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if _, err = conn.Exec(ctx, "LISTEN "+events.Channel); err != nil {
		t.Fatal(err)
	}
	tr.insert(t, genreWiki, "Wake", "")
	wctx, cancel := context.WithTimeout(ctx, wakeWait)
	defer cancel()
	if _, err = conn.Conn().WaitForNotification(wctx); err != nil {
		t.Fatalf("no notification after a note insert: %v", err)
	}
}
