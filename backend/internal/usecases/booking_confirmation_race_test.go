// booking_confirmation_race_test.go —— #6: claim-before-send makes concurrent double-send
// impossible. Two deliveries both pass the read-time idempotency check (booking.ConfirmationSentAt
// is still nil for both), but the atomic MarkBookingConfirmed claim lets only the first send; the
// second gets ErrBookingConfirmationSent and sends nothing.

package usecases

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// claimOnceCalendar —— models the DB CAS: first MarkBookingConfirmed claims (nil), later ones
// reports ErrBookingAlreadyConfirmed. LatestBookingForConversation keeps returning the unclaimed
// booking (sent_at nil) so both deliveries pass the read-time check — the claim is the real gate.
type claimOnceCalendar struct {
	booking domain.CodeBooking
	claimed bool
	clears  int
}

func (c *claimOnceCalendar) LatestBookingForConversation(
	_ context.Context, _ string,
) (domain.CodeBooking, error) {
	return c.booking, nil
}

func (c *claimOnceCalendar) MarkBookingConfirmed(_ context.Context, _ string) error {
	if c.claimed {
		return domain.ErrBookingAlreadyConfirmed
	}
	c.claimed = true
	return nil
}

func (c *claimOnceCalendar) ClearBookingConfirmed(_ context.Context, _ string) error {
	c.clears++
	return nil
}

type fakeOwnerGetter struct{}

func (fakeOwnerGetter) GetByID(_ context.Context, _ string) (domain.Owner, error) {
	return domain.Owner{}, nil
}

type spyMailProxy struct{ sends int }

func (*spyMailProxy) Connected(_ context.Context, _ string) (bool, error) { return true, nil }

func (s *spyMailProxy) Send(_ context.Context, _ string, _ MailMessage) error {
	s.sends++
	return nil
}

func TestConfirmationClaimBeforeSendNoDoubleSend(t *testing.T) {
	t.Parallel()
	cal := &claimOnceCalendar{booking: baseBooking()}
	proxy := &spyMailProxy{}
	deps := BookingConfirmDeps{Calendar: cal, Owners: fakeOwnerGetter{}, Proxy: proxy}
	in := confirmInput("attendee@example.com", "attendee@example.com")

	err1 := SendBookingConfirmation(context.Background(), deps, in)
	err2 := SendBookingConfirmation(context.Background(), deps, in)

	require.NoError(t, err1)
	require.ErrorIs(t, err2, ErrBookingConfirmationSent, "second delivery must lose the claim")
	require.Equal(t, 1, proxy.sends, "claim-before-send: exactly one email despite two deliveries")
}
