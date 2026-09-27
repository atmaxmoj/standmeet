package subscriber_test

// The email-change confirmation job: it mints the link's token when it sends, and a change that
// was cancelled or replaced meanwhile sends nothing.

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/entity"
	"github.com/atmaxmoj/standmeet/internal/owner/repo"
	"github.com/atmaxmoj/standmeet/internal/owner/usecase"
)

func (f *mailFixture) startPending(t *testing.T, email string) {
	t.Helper()
	if _, err := f.deps.Owners.StartPendingEmail(context.Background(), &repo.PendingEmailStart{
		OwnerID: f.owner, NewEmail: email, TokenHash: "placeholder",
		ExpiresAt: time.Now().Add(time.Hour),
	}, func(pgstore.Tx) (int64, error) { return 1, nil }); err != nil {
		t.Fatal(err)
	}
}

func (f *mailFixture) confirm(t *testing.T, email string) error {
	t.Helper()
	raw, err := json.Marshal(entity.EmailConfirmArgs{OwnerID: f.owner, Email: email})
	if err != nil {
		t.Fatal(err)
	}
	return kindOf(t, f.deps, entity.EmailConfirmKind).Handle(context.Background(), raw)
}

// TestEmailConfirm_linkMatchesAndStaleSendsNothing — the mailed token is the one the pending row
// now accepts; a job for a change that was since replaced sends nothing.
func TestEmailConfirm_linkMatchesAndStaleSendsNothing(t *testing.T) {
	t.Parallel()
	f := mailSetup(t)
	f.startPending(t, "new@example.com")
	f.confirmSends(t, "new@example.com", 1)
	_, after, _ := strings.Cut(f.reg.sent[0].Body, "token=")
	if f.storedTokenHash(t) != usecase.HashEmailToken(strings.Fields(after)[0]) {
		t.Error("the mailed link's token must be the one the pending row accepts")
	}
	f.startPending(t, "other@example.com")
	f.confirmSends(t, "new@example.com", 1) // the replaced change sends nothing more
}

// confirmSends —— runs the confirmation job for email; total mails sent must then be want.
func (f *mailFixture) confirmSends(t *testing.T, email string, want int) {
	t.Helper()
	if err := f.confirm(t, email); err != nil || len(f.reg.sent) != want {
		t.Fatalf("confirmation for %s: want %d mail(s) in all, err=%v sent=%d",
			email, want, err, len(f.reg.sent))
	}
}

func (f *mailFixture) storedTokenHash(t *testing.T) string {
	t.Helper()
	var hash string
	const q = `SELECT pending_email_token_hash FROM owners WHERE id = $1`
	if err := f.pool.QueryRow(context.Background(), q, f.owner).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	return hash
}
