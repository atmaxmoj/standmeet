// booking_confirmation_test.go —— #122 确认信"定位 + 归属 + 幂等 + 收件人"那一关
// (resolveConfirmation)的纯逻辑单测。用 fake ConfirmationCalendar,不碰 DB / mail。
// 重点盖**幂等**:已发过(ConfirmationSentAt != nil)再发 → ErrBookingConfirmationSent
// —— 这条 UI 锁了卡片所以 e2e 走不到,只能单测。

package usecases

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

const (
	tcOwner = "owner-1"
	tcCode  = "code-1"
	tcConv  = "conv-1"
)

// fakeConfirmCalendar —— 可配的 ConfirmationCalendar 假实现。
type fakeConfirmCalendar struct {
	lookupErr error
	booking   domain.CodeBooking
}

func (f *fakeConfirmCalendar) LatestBookingForConversation(
	_ context.Context, _ string,
) (domain.CodeBooking, error) {
	if f.lookupErr != nil {
		return domain.CodeBooking{}, f.lookupErr
	}
	return f.booking, nil
}

func (*fakeConfirmCalendar) MarkBookingConfirmed(_ context.Context, _ string) error {
	return nil
}

func baseBooking() domain.CodeBooking {
	return domain.CodeBooking{
		ID: "bk-1", OwnerID: tcOwner, CodeID: tcCode, ConversationID: tcConv,
		Summary: "Intro call", VisitorEmail: "v@example.com",
	}
}

func confirmInput(recipient, sessionEmail string) *SendBookingConfirmationInput {
	return &SendBookingConfirmationInput{
		OwnerID: tcOwner, ConversationID: tcConv, CodeID: tcCode,
		Recipient: recipient, SessionEmail: sessionEmail,
	}
}

func resolveWith(
	b *domain.CodeBooking, in *SendBookingConfirmationInput,
) (confirmationTarget, error) {
	deps := BookingConfirmDeps{Calendar: &fakeConfirmCalendar{booking: *b}}
	return resolveConfirmation(context.Background(), deps, in)
}

// 幂等:已发过 → ErrBookingConfirmationSent(UI 锁卡,e2e 走不到这条)。
func TestResolveConfirmationIdempotent(t *testing.T) {
	t.Parallel()
	sent := time.Now()
	b := baseBooking()
	b.ConfirmationSentAt = &sent
	_, err := resolveWith(&b, confirmInput("", "v@example.com"))
	if !errors.Is(err, ErrBookingConfirmationSent) {
		t.Fatalf("err = %v, want ErrBookingConfirmationSent", err)
	}
}

// 归属:owner / code 任一不匹 → ErrBookingNotFound(不泄露存在性)。
func TestResolveConfirmationScope(t *testing.T) {
	t.Parallel()
	wrongOwner := baseBooking()
	wrongOwner.OwnerID = "other"
	wrongCode := baseBooking()
	wrongCode.CodeID = "other"
	for name, b := range map[string]domain.CodeBooking{"owner": wrongOwner, "code": wrongCode} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := resolveWith(&b, confirmInput("", "v@example.com"))
			if !errors.Is(err, domain.ErrBookingNotFound) {
				t.Fatalf("err = %v, want ErrBookingNotFound", err)
			}
		})
	}
}

// 收件人:透传优先,否则引用 session;空/非法 → ErrBookingNoRecipient。
func TestResolveConfirmationRecipient(t *testing.T) {
	t.Parallel()
	cases := []struct {
		wantErr   error
		name      string
		recipient string
		session   string
		want      string
	}{
		{name: "passthrough wins", recipient: "a@x.co", session: "b@x.co", want: "a@x.co"},
		{name: "session fallback", recipient: "", session: "b@x.co", want: "b@x.co"},
		{name: "none", recipient: "", session: "", wantErr: ErrBookingNoRecipient},
		{name: "invalid", recipient: "nope", session: "", wantErr: ErrBookingNoRecipient},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			b := baseBooking()
			tgt, err := resolveWith(&b, confirmInput(tc.recipient, tc.session))
			checkRecipient(t, tgt.Recipient, err, tc.want, tc.wantErr)
		})
	}
}

func checkRecipient(t *testing.T, got string, err error, want string, wantErr error) {
	t.Helper()
	if wantErr != nil {
		if !errors.Is(err, wantErr) {
			t.Fatalf("err = %v, want %v", err, wantErr)
		}
		return
	}
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if got != want {
		t.Fatalf("recipient = %q, want %q", got, want)
	}
}

// LatestBooking 出错(非 not-found)→ resolve 原样 wrap 上抛,不当成可发。
func TestResolveConfirmationLookupError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("db down")
	deps := BookingConfirmDeps{Calendar: &fakeConfirmCalendar{lookupErr: sentinel}}
	_, err := resolveConfirmation(context.Background(), deps, confirmInput("", "v@example.com"))
	if !errors.Is(err, sentinel) {
		t.Fatalf("err = %v, want wrap of %v", err, sentinel)
	}
}
