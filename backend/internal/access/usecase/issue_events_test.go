package usecase_test

// Issuing a code or an API key records code.issued / api_key.issued in the row's own transaction:
// the event exists if and only if the write committed (docs/design/event-bus-outbox-webhooks.md,
// *Two ways an event is born*).

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/atmaxmoj/standmeet/internal/access/repo"
	"github.com/atmaxmoj/standmeet/internal/access/usecase"
	"github.com/atmaxmoj/standmeet/internal/infra/events"
)

// issueRig —— a scratch database with one owner and one role, and a recorder over types.
type issueRig struct {
	pool          *pgxpool.Pool
	rec           events.Recorder
	owner, roleID string
}

func newIssueRig(t *testing.T, types []events.Type) *issueRig {
	t.Helper()
	pool := scratchDB(t)
	ctx := context.Background()
	r := &issueRig{pool: pool}
	if err := pool.QueryRow(ctx, `INSERT INTO owners
		(email, password_hash, handle, full_name) VALUES ('o@example.com', 'x', 'o', 'O')
		RETURNING id`).Scan(&r.owner); err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO roles (owner_id, name) VALUES ($1, 'invited')
		RETURNING id`, r.owner).Scan(&r.roleID); err != nil {
		t.Fatalf("seed role: %v", err)
	}
	bus, err := events.New(pool, types, nil)
	if err != nil {
		t.Fatal(err)
	}
	r.rec = bus.Recorder()
	return r
}

func (r *issueRig) count(t *testing.T, q string) int {
	t.Helper()
	var n int
	if err := r.pool.QueryRow(context.Background(), q).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (r *issueRig) issueCode(ctx context.Context) error {
	d := usecase.CodesDeps{
		Codes: repo.NewCodeRepo(r.pool), Roles: repo.NewRoleRepo(r.pool), Events: r.rec,
	}
	_, err := usecase.IssueCode(ctx, d, &repo.CreateCodeInput{
		OwnerID: r.owner, Label: "Acme", AssumedRoleID: r.roleID,
	})
	return err
}

func (r *issueRig) issueKey(ctx context.Context) error {
	d := usecase.IssueAPIKeyDeps{
		Keys: repo.NewAPIKeyRepo(r.pool), Roles: repo.NewRoleRepo(r.pool), Events: r.rec,
	}
	_, err := usecase.IssueAPIKey(ctx, d, &usecase.IssueAPIKeyInput{
		OwnerID: r.owner, AssumedRoleID: r.roleID, Label: "ci",
	})
	return err
}

// issueCase —— one issuing use case: what it writes, and the event that names the row.
type issueCase struct {
	issue func(r *issueRig, ctx context.Context) error
	name  string
	rows  string // counts the rows the use case wrote
	event string // counts the events that name one of those rows
}

var issueCases = []issueCase{{
	name: "code.issued", issue: (*issueRig).issueCode,
	rows: `SELECT count(*) FROM access_codes`,
	event: `SELECT count(*) FROM events e JOIN access_codes c ON e.subject = 'code/' || c.id
		WHERE e.type = 'code.issued' AND e.data->>'code_id' = c.id::text`,
}, {
	name: "api_key.issued", issue: (*issueRig).issueKey,
	rows: `SELECT count(*) FROM api_keys`,
	event: `SELECT count(*) FROM events e JOIN api_keys k ON e.subject = 'api_key/' || k.id
		WHERE e.type = 'api_key.issued' AND e.data->>'key_id' = k.id::text`,
}}

// TestIssue_eventCommitsWithTheRow —— one row, one event naming it.
func TestIssue_eventCommitsWithTheRow(t *testing.T) {
	t.Parallel()
	for _, c := range issueCases {
		t.Run(c.name, func(t *testing.T) { t.Parallel(); commitsWithTheRow(t, &c) })
	}
}

// TestIssue_noEventNoRow —— the event cannot be recorded (undeclared), so nothing is issued.
func TestIssue_noEventNoRow(t *testing.T) {
	t.Parallel()
	for _, c := range issueCases {
		t.Run(c.name, func(t *testing.T) { t.Parallel(); rollsBackWithoutEvent(t, &c) })
	}
}

func commitsWithTheRow(t *testing.T, c *issueCase) {
	t.Helper()
	r := newIssueRig(t, usecase.EventTypes())
	if err := c.issue(r, context.Background()); err != nil {
		t.Fatal(err)
	}
	if n, e := r.count(t, c.rows), r.count(t, c.event); n != 1 || e != 1 {
		t.Errorf("want 1 row and 1 event naming it, got %d rows, %d events", n, e)
	}
}

func rollsBackWithoutEvent(t *testing.T, c *issueCase) {
	t.Helper()
	r := newIssueRig(t, []events.Type{})
	if err := c.issue(r, context.Background()); err == nil {
		t.Fatal("recording failed, so issuing must fail")
	}
	if n := r.count(t, c.rows); n != 0 {
		t.Errorf("the row must roll back with its event, found %d", n)
	}
}
