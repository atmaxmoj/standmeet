// capreg_booker_cancel_test.go —— calendar_cancel host op 的错误映射单测。访客面只该
// 看到明确语义（booking_not_found）或友好降级，绝不泄漏底层错误文本。

package usecases

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

func TestMarshalCancelErr_NotFoundAndNoLeak(t *testing.T) {
	t.Parallel()
	require.Contains(t, marshalCancelErr(domain.ErrBookingNotFound), "booking_not_found")

	dirty := errors.New("delete gcal event: dial tcp: connection refused; goroutine stack")
	out := strings.ToLower(marshalCancelErr(dirty))
	require.Contains(t, out, "try again")
	for _, leak := range []string{"dial tcp", "connection refused", "goroutine", "stack", "gcal"} {
		require.NotContains(t, out, leak, "leaked %q: %q", leak, out)
	}
}

func TestRunBookerCancel_InvalidArgs(t *testing.T) {
	t.Parallel()
	out, err := runBookerCancel(
		t.Context(), &BookerDeps{}, &bookerCallInput{}, []byte("{bad"))
	require.NoError(t, err)
	require.Contains(t, out, "invalid_args")
}
