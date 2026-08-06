// textcut_test.go —— the property every caller depends on: what comes out is still valid UTF-8.
//
// The repro that motivated this package: a raw dump whose first line is a normal Chinese
// sentence. The old `line[:60]` cut byte 60, which lands inside a 3-byte Han character, and
// postgres rejected the whole INSERT with `invalid byte sequence for encoding "UTF8": 0xe2`.
// The note was simply lost.

package textcut_test

import (
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/atmaxmoj/standmeet/internal/infra/textcut"
)

const (
	// han —— a Han code point, built via rune() so this file carries no non-ASCII source literal.
	han = rune(0x63A7)
	// bytesPerHan —— what makes this class of bug possible at all.
	bytesPerHan = 3

	sampleChars = 40 // the sample line's length, in characters
	shortCap    = 10 // a cap well under sampleChars, so every call truncates
	markChars   = 1  // the mark textcut appends when it cut
	longChars   = 200
	rawTitleCap = 60 // the cap the raw-title derivation uses
)

func TestRunesNeverSplitsACharacter(t *testing.T) {
	t.Parallel()
	line := strings.Repeat(string(han), sampleChars)
	if len(line) != sampleChars*bytesPerHan {
		t.Fatalf("sample is %d bytes, expected %d", len(line), sampleChars*bytesPerHan)
	}
	for _, n := range []int{1, shortCap, sampleChars - 1, sampleChars, sampleChars + 1} {
		got := textcut.Runes(line, n)
		if !utf8.ValidString(got) {
			t.Fatalf("Runes(%d) produced invalid UTF-8: %q", n, got)
		}
		if want := min(n, sampleChars); utf8.RuneCountInString(got) != want {
			t.Fatalf("Runes(%d) kept %d characters, want %d", n, utf8.RuneCountInString(got), want)
		}
	}
}

func TestRunesMarkMarksOnlyWhenItCut(t *testing.T) {
	t.Parallel()
	short := "hello"
	if got := textcut.RunesMark(short, shortCap); got != short {
		t.Fatalf("RunesMark on a string under the cap changed it: %q", got)
	}
	got := textcut.RunesMark(strings.Repeat(string(han), sampleChars), shortCap)
	if !utf8.ValidString(got) {
		t.Fatalf("RunesMark produced invalid UTF-8: %q", got)
	}
	if !strings.HasSuffix(got, textcut.Mark) {
		t.Fatalf("RunesMark cut but left no mark: %q", got)
	}
	if want := shortCap + markChars; utf8.RuneCountInString(got) != want {
		t.Fatalf("RunesMark kept %d characters, want %d", utf8.RuneCountInString(got), want)
	}
}

func TestBytesMarkStaysUnderTheBudget(t *testing.T) {
	t.Parallel()
	body := strings.Repeat(string(han), longChars)
	full := len(body)
	for _, budget := range []int{1, 2, bytesPerHan, bytesPerHan + 1, full - 1, full, full + 1} {
		got := textcut.BytesMark(body, budget)
		if !utf8.ValidString(got) {
			t.Fatalf("BytesMark(%d) produced invalid UTF-8: %q", budget, got)
		}
		if payload := strings.TrimSuffix(got, textcut.Mark); len(payload) > budget {
			t.Fatalf("BytesMark(%d) kept %d bytes, over budget", budget, len(payload))
		}
	}
}

// The exact shape that broke: a title-length line of Han characters, cut at the title cap.
func TestRunesMarkAtTheRawTitleCap(t *testing.T) {
	t.Parallel()
	got := textcut.RunesMark(strings.Repeat(string(han), longChars), rawTitleCap)
	if !utf8.ValidString(got) {
		t.Fatalf("a Han first line cut at the raw-title cap is not valid UTF-8: %q", got)
	}
}
