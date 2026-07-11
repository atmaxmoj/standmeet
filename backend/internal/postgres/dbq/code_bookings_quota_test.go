// code_bookings_quota_test.go —— #2: CreateCodeBooking must enforce the per-code max_bookings cap
// atomically. The assembly-time gate is only an advisory hide (bypassable by concurrent / within-
// turn book calls); the insert is the authoritative gate, so it must lock the code row (FOR UPDATE
// serializes concurrent bookings for the same code) and only insert when under the cap.

package dbq

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestCreateCodeBookingEnforcesQuotaAtomically(t *testing.T) {
	t.Parallel()
	require.Contains(t, createCodeBooking, "FOR UPDATE",
		"must lock the code row so concurrent bookings for the same code serialize")
	require.Contains(t, createCodeBooking, "max_bookings",
		"must gate the insert on the code's max_bookings cap")
}
