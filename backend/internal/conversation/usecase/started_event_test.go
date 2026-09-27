package usecase_test

// Opening a conversation records conversation.started in the same transaction as its row: the
// event exists if and only if the conversation does (docs/design/event-bus-outbox-webhooks.md,
// *Two ways an event is born*).

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/conversation/repo"
	"github.com/atmaxmoj/standmeet/internal/conversation/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

// codeMember —— an owner, a role, a code and one member of it: the ids a doc conversation needs.
func codeMember(t *testing.T, pool *pgxpool.Pool) *usecase.OpenConvForDocInput {
	t.Helper()
	ctx := context.Background()
	in := &usecase.OpenConvForDocInput{Mode: "code", DocKey: "projects/x"}
	err := pool.QueryRow(ctx, `INSERT INTO owners (email, password_hash, handle, full_name)
		VALUES ('o@example.com', 'x', 'o', 'O') RETURNING id`).Scan(&in.OwnerID)
	const code = `WITH r AS
		(INSERT INTO roles (owner_id, name) VALUES ($1, 'invited') RETURNING id)
		INSERT INTO access_codes (owner_id, code, label, slug, assumed_role_id)
		SELECT $1, 'ACME-1', 'Acme', 'acme', r.id FROM r RETURNING id`
	if err == nil {
		err = pool.QueryRow(ctx, code, in.OwnerID).Scan(&in.CodeID)
	}
	if err == nil {
		err = pool.QueryRow(ctx, `INSERT INTO code_members (code_id, display_name)
			VALUES ($1, 'Ann') RETURNING id`, in.CodeID).Scan(&in.MemberID)
	}
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	return in
}

func openDocConversation(t *testing.T, types []events.Type) (*pgxpool.Pool, error) {
	t.Helper()
	pool := scratchDB(t)
	in := codeMember(t, pool)
	bus, err := events.New(pool, types, nil)
	if err != nil {
		t.Fatal(err)
	}
	deps := &usecase.VisitorSessionDeps{
		Codes: access.NewCodeRepo(pool), Chats: repo.NewChatRepo(pool), Events: bus.Recorder(),
	}
	_, err = usecase.OpenConversationForDoc(context.Background(), deps, in)
	return pool, err
}

func countOf(t *testing.T, pool *pgxpool.Pool, q string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), q).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestOpenConversation_startedCommitsWithTheRow(t *testing.T) {
	t.Parallel()
	pool, err := openDocConversation(t, usecase.EventTypes())
	if err != nil {
		t.Fatal(err)
	}
	named := countOf(t, pool, `SELECT count(*) FROM events e JOIN conversations c
		ON e.subject = 'conversation/' || c.id AND e.data->>'conversation_id' = c.id::text
		WHERE e.type = 'conversation.started' AND e.data->>'mode' = 'code'`)
	if rows := countOf(t, pool, `SELECT count(*) FROM conversations`); rows != 1 || named != 1 {
		t.Errorf("want 1 conversation and 1 conversation.started naming it, got %d and %d",
			rows, named)
	}
}

func TestOpenConversation_noEventNoRow(t *testing.T) {
	t.Parallel()
	pool, err := openDocConversation(t, []events.Type{})
	if err == nil {
		t.Fatal("recording failed, so opening must fail")
	}
	if rows := countOf(t, pool, `SELECT count(*) FROM conversations`); rows != 0 {
		t.Errorf("the conversation must roll back with its event, found %d", rows)
	}
}
