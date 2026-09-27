package usecase_test

// A recovery-phrase sign-in is a sign-in: it records owner.login, in the same transaction that
// spends the single-use phrase — like the password path does (docs/design/event-bus-outbox-
// webhooks.md, the owner.login webhook type).

import (
	"context"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/atmaxmoj/standmeet/internal/infra/events"
	"github.com/atmaxmoj/standmeet/internal/infra/session"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

const recoveryPhrase = "k7m2-9xqp"

// seedRecoverableOwner —— an owner holding a recovery phrase; returns the owner id.
func seedRecoverableOwner(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	hash, err := session.HashPassword(recoveryPhrase)
	if err != nil {
		t.Fatal(err)
	}
	var owner string
	err = pool.QueryRow(context.Background(), `INSERT INTO owners
		(email, password_hash, handle, full_name, recovery_hash)
		VALUES ('r@example.com', 'x', 'r', 'R', $1) RETURNING id`, hash).Scan(&owner)
	if err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	return owner
}

func recoveryDeps(t *testing.T, pool *pgxpool.Pool) *usecase.RecoveryDeps {
	t.Helper()
	bus, err := events.New(pool, []events.Type{{Type: usecase.OwnerLogin}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	return &usecase.RecoveryDeps{
		Owners:   repo.NewRepo(pool),
		Sessions: session.NewOwnerSessionStore(rdb),
		Events:   bus.Recorder(),
	}
}

// countWith —— a count(*) query taking two text arguments.
func countWith(t *testing.T, pool *pgxpool.Pool, q, a, b string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), q, a, b).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRecoverSignInRecordsOwnerLogin(t *testing.T) {
	t.Parallel()
	pool := scratchDB(t)
	owner := seedRecoverableOwner(t, pool)
	in := &usecase.RecoverInput{Email: "r@example.com", Phrase: recoveryPhrase}
	if _, err := usecase.Recover(context.Background(), recoveryDeps(t, pool), in); err != nil {
		t.Fatalf("recover: %v", err)
	}
	logins := countWith(t, pool, `SELECT count(*) FROM events WHERE type = $1 AND subject = $2`,
		usecase.OwnerLogin, "owner/"+owner)
	unspent := countWith(t, pool, `SELECT count(*) FROM owners WHERE id::text = $1
		AND recovery_hash <> $2`, owner, "")
	if logins != 1 || unspent != 0 {
		t.Fatalf("owner.login events = %d, unspent phrases = %d; want 1 and 0", logins, unspent)
	}
}
