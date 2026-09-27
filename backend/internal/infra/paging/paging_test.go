package paging_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
)

type row struct {
	at time.Time
	id string
}

func key(r *row) paging.Cursor { return paging.Cursor{At: r.at, ID: r.id} }

func TestCursorRoundTrip(t *testing.T) {
	t.Parallel()
	c := paging.Cursor{At: time.Now().Add(time.Nanosecond * 456789), ID: "abc"}
	got, err := paging.Decode(c.Encode())
	require.NoError(t, err)
	require.Equal(t, c.ID, got.ID)
	require.True(t, c.At.Equal(got.At), "the cursor keeps sub-second precision")
}

func TestDecodeRejectsForeignCursors(t *testing.T) {
	t.Parallel()
	first, err := paging.Decode("")
	require.NoError(t, err)
	require.Nil(t, first, "empty is the first page")
	for _, bad := range []string{"!!", "bm8tc2VwYXJhdG9y", "bm90LWEtdGltZXxpZA"} {
		_, derr := paging.Decode(bad)
		require.ErrorIs(t, derr, paging.ErrBadCursor, bad)
	}
}

func TestCutKeepsLimitAndPointsAtTheLastKeptRow(t *testing.T) {
	t.Parallel()
	in, err := paging.ParseArgs[struct{}](json.RawMessage(`{"limit":2}`))
	require.NoError(t, err)
	require.Equal(t, int32(3), in.Req.Fetch())
	base := time.Now()
	rows := []row{{base, "a"}, {base.Add(-time.Second), "b"}, {base.Add(-2 * time.Second), "c"}}

	page := paging.Cut(rows, in.Req, key)
	require.Len(t, page.Items, 2)
	next, err := paging.Decode(page.NextCursor)
	require.NoError(t, err)
	require.Equal(t, "b", next.ID, "the next page starts after the last row shown")

	last := paging.Cut(rows[:2], in.Req, key)
	require.Empty(t, last.NextCursor, "no extra row = no next page")
}

func TestLimitIsClamped(t *testing.T) {
	t.Parallel()
	const asked = 7
	for raw, want := range map[string]int32{
		`{}`: paging.DefaultLimit, `{"limit":-3}`: paging.DefaultLimit,
		`{"limit":9999}`: paging.MaxLimit, `{"limit":7}`: asked,
	} {
		in, err := paging.ParseArgs[struct{}](json.RawMessage(raw))
		require.NoError(t, err)
		require.Equal(t, want, in.Req.Limit, raw)
	}
}
