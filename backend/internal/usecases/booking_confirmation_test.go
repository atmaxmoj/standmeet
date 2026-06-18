// booking_confirmation_test.go —— #122 确认信"定位 + 归属 + 幂等 + 收件人"那一关
// (resolveConfirmation)+ schema.org markup 的纯逻辑单测。用 fake ConfirmationCalendar,
// 不碰 DB / mail。测试跑在确定环境下 → 断言一律 require.*(无 if 分支)。
// 重点盖**幂等**:已发过(ConfirmationSentAt != nil)再发 → ErrBookingConfirmationSent
// —— 这条 UI 锁了卡片所以 e2e 走不到,只能单测。

package usecases

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

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
	return f.booking, f.lookupErr
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
	require.ErrorIs(t, err, ErrBookingConfirmationSent)
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
			require.ErrorIs(t, err, domain.ErrBookingNotFound)
		})
	}
}

// 收件人 ok:透传优先,否则引用 session。
func TestResolveConfirmationRecipientOK(t *testing.T) {
	t.Parallel()
	cases := map[string]struct{ recipient, session, want string }{
		"passthrough wins": {recipient: "a@x.co", session: "b@x.co", want: "a@x.co"},
		"session fallback": {recipient: "", session: "b@x.co", want: "b@x.co"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			b := baseBooking()
			tgt, err := resolveWith(&b, confirmInput(tc.recipient, tc.session))
			require.NoError(t, err)
			require.Equal(t, tc.want, tgt.Recipient)
		})
	}
}

// 收件人不可用:空 / 非法 → ErrBookingNoRecipient。
func TestResolveConfirmationRecipientRejected(t *testing.T) {
	t.Parallel()
	cases := map[string]struct{ recipient, session string }{
		"none":    {recipient: "", session: ""},
		"invalid": {recipient: "nope", session: ""},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			b := baseBooking()
			_, err := resolveWith(&b, confirmInput(tc.recipient, tc.session))
			require.ErrorIs(t, err, ErrBookingNoRecipient)
		})
	}
}

// LatestBooking 出错(非 not-found)→ resolve 原样 wrap 上抛,不当成可发。
func TestResolveConfirmationLookupError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("db down")
	deps := BookingConfirmDeps{Calendar: &fakeConfirmCalendar{lookupErr: sentinel}}
	_, err := resolveConfirmation(context.Background(), deps, confirmInput("", "v@example.com"))
	require.ErrorIs(t, err, sentinel)
}

// confirmationJSONLD 必须产出 Gmail EventReservation 的必填字段:reservationNumber
// + reservationStatus + reservationFor(name + startDate + location[VirtualLocation])。
func TestConfirmationJSONLD(t *testing.T) {
	t.Parallel()
	b := baseBooking()
	b.GoogleEventID = "evt-xyz"
	b.GoogleHTMLLink = "https://calendar.google.com/event?eid=evt-xyz"
	jld := confirmationJSONLD(&b, time.UTC)
	for _, want := range []string{
		`"@type":"EventReservation"`,
		`"reservationStatus":"https://schema.org/ReservationConfirmed"`,
		`"reservationNumber":"evt-xyz"`,
		`"reservationFor"`,
		`"name":"Intro call"`,
		`"startDate":"`,
		`"location":{"@type":"VirtualLocation"`,
	} {
		require.Contains(t, jld, want)
	}
}
