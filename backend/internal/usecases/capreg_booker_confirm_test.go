// capreg_booker_confirm_test.go —— send_confirmation host op 的错误映射单测。
// 访客面只该看到明确语义码（no_recipient/already_sent/mail_not_configured）或友好
// 通用降级，绝不泄漏底层错误文本。业务代码 with/without 本测试一样。

package usecases

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

func TestMarshalConfirmationErr_KnownCases(t *testing.T) {
	t.Parallel()
	require.Contains(t, marshalConfirmationErr(domain.ErrBookingNotFound), "booking_not_found")
	require.Contains(t, marshalConfirmationErr(ErrBookingNoRecipient), "no_recipient")
	require.Contains(t, marshalConfirmationErr(ErrBookingConfirmationSent), "already_sent")
	require.Contains(t, marshalConfirmationErr(ErrMailNotConfigured), "mail_not_configured")
}

// 未预期错误 → 友好通用降级 + 不泄漏底层文本（同 booked host-edge 的 no-leak 约束）。
func TestMarshalConfirmationErr_UnexpectedNoLeak(t *testing.T) {
	t.Parallel()
	dirty := errors.New("smtp dial tcp 1.2.3.4:587: connection refused; cipher x")
	out := marshalConfirmationErr(dirty)
	lower := strings.ToLower(out)
	require.Contains(t, lower, "try again")
	for _, leak := range []string{"smtp", "dial tcp", "connection refused", "cipher", "587"} {
		require.NotContains(t, lower, leak, "leaked %q: %q", leak, out)
	}
}

// invalid args（坏 JSON）→ invalid_args，不崩。
func TestRunBookerSendConfirmation_InvalidArgs(t *testing.T) {
	t.Parallel()
	out, err := runBookerSendConfirmation(
		t.Context(), &BookerDeps{}, &bookerCallInput{}, []byte("{bad"))
	require.NoError(t, err)
	require.Contains(t, out, "invalid_args")
}
