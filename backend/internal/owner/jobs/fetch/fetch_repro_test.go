// fetch_repro_test.go —— RED repro for confirmed job-fetch defects (bug hunt #12, #10). Pure
// helpers, no stack. These demonstrate the wrong behavior against current code; the fix lands
// separately.

package fetch

import (
	"io"
	"net/http"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/stretchr/testify/require"
)

// TestHNFirstLineTruncatesOnRuneBoundary —— #12: hnFirstLine's doc says "truncated to
// hnTitleMaxLen runes" but the code does `len(first) > 120` (bytes) + `first[:120]` (byte slice).
// A multibyte rune straddling byte 120 is sliced in half → the title becomes invalid UTF-8 (a
// mojibake � at the cut), corrupting the job listing / resume draft / QR page.
// multibyteReps —— "x" + this many 3-byte runes = 1 + 3N bytes; N=45 → 136 bytes, so byte 120
// (hnTitleMaxLen) lands in the middle of a rune ('€' is U+20AC = 3 bytes).
const multibyteReps = 45

func TestHNFirstLineTruncatesOnRuneBoundary(t *testing.T) {
	t.Parallel()
	line := "x" + strings.Repeat("€", multibyteReps)
	got := hnFirstLine(line)
	require.True(t, utf8.ValidString(got),
		"truncated HN title must stay valid UTF-8 (truncate on a rune boundary, not byte 120)")
}

// constReader —— an endless reader of a single byte; wrapped in io.LimitReader to synthesize an
// oversized upstream body without a large literal.
type constReader byte

func (b constReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = byte(b)
	}
	return len(p), nil
}

// TestReadOKBoundsBodySize —— #10: readOK does io.ReadAll(resp.Body) with no LimitReader, so a
// hostile/broken upstream (or a job board serving a huge page) forces the whole body into memory —
// unbounded-read DoS. readOK must cap the body it will accept. (decodeGzippedJSONArray's unbounded
// gunzip is the same defect / same fix.)
func TestReadOKBoundsBodySize(t *testing.T) {
	t.Parallel()
	const oversized = 12 << 20 // 12 MiB — far beyond any legitimate job-board page
	resp := &http.Response{
		StatusCode: http.StatusOK,
		Body:       io.NopCloser(io.LimitReader(constReader('a'), oversized)),
	}
	_, err := readOK(resp, "http://board.example/huge")
	require.Error(t, err,
		"readOK must bound the response body, not ReadAll an unbounded upstream")
}
