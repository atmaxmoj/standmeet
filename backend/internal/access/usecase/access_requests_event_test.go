package usecase_test

// A submitted access request records access_request.created in the same transaction as its row:
// both land, or neither does (docs/design/event-bus-outbox-webhooks.md, *Phase 4*).

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

type soleOwner string

func (s soleOwner) SoleOwnerID(context.Context) (string, error) { return string(s), nil }

func submitDeps(
	t *testing.T, pool *pgxpool.Pool, types []events.Type,
) (usecase.RequestsDeps, string) {
	t.Helper()
	var owner string
	if err := pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name) VALUES ('o@example.com', 'x', 'o', 'O')
		RETURNING id`).Scan(&owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	bus, err := events.New(pool, types, nil)
	if err != nil {
		t.Fatal(err)
	}
	return usecase.RequestsDeps{
		Repo: repo.NewAccessRequestRepo(pool), Owners: soleOwner(owner),
		Pool: pool, Events: bus.Recorder(),
	}, owner
}

func visitor() *usecase.SubmitAccessRequestInput {
	return &usecase.SubmitAccessRequestInput{Name: "V", Email: "v@example.com", Message: "may I?"}
}

// TestSubmit_recordsTheEventWithTheRow — the committed request has exactly one
// access_request.created naming it.
func TestSubmit_recordsTheEventWithTheRow(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	deps, owner := submitDeps(t, pool, usecase.EventTypes())
	ctx := context.Background()
	req, err := usecase.SubmitForOwner(ctx, deps, visitor())
	if err != nil {
		t.Fatal(err)
	}
	var n int
	const q = `SELECT count(*) FROM events
		WHERE type = 'access_request.created' AND owner_id = $1 AND subject = $2
		AND data->>'request_id' = $3`
	if err = pool.QueryRow(ctx, q, owner, "access_request/"+req.ID, req.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("want one access_request.created for the request, got %d", n)
	}
}

// TestSubmit_noEventNoRow — the event cannot be recorded (its type is undeclared), so the request
// is not stored either: "stored but nobody will ever hear of it" cannot happen.
func TestSubmit_noEventNoRow(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	deps, _ := submitDeps(t, pool, []events.Type{})
	ctx := context.Background()
	if _, err := usecase.SubmitForOwner(ctx, deps, visitor()); err == nil {
		t.Fatal("recording failed, so the submission must fail")
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM access_requests`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("the request row must roll back with its event, found %d rows", n)
	}
}
