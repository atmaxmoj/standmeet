//nolint:testpackage // white-box: pageRows is unexported paging logic tested beside it.
package usecase

import "testing"

func rowsN(n int) []Meta {
	out := make([]Meta, 0, n)
	for i := range n {
		out = append(out, Meta{Path: string(rune('a' + i))})
	}
	return out
}

// TestPageRowsCapsAndPages — the merged search returns up to four genres' hits at once; without a
// cap a broad query renders the whole corpus in one wall ("会炸的"). A zero limit caps at the
// default, a big limit is clamped, and offset pages through a stable order.
//
//nolint:revive // the offset/limit/expected windows ARE the test's data — naming each is noise
func TestPageRowsCapsAndPages(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name           string
		total          int
		offset, limit  int
		wantLen        int
		wantFirstIndex int // index into rowsN of the first returned row, -1 for empty
	}{
		{"zero limit caps at default", 80, 0, 0, searchDefaultLimit, 0},
		{"explicit small limit", 80, 0, 8, 8, 0},
		{"limit clamped to max", 80, 0, 999, searchMaxLimit, 0},
		{"offset pages forward", 30, 8, 8, 8, 8},
		{"offset past end is empty", 10, 50, 8, 0, -1},
		{"last partial page", 25, 20, 20, 5, 20},
		{"negative offset treated as zero", 10, -5, 4, 4, 0},
	}
	for _, c := range cases {
		got := pageRows(rowsN(c.total), c.offset, c.limit)
		if len(got) != c.wantLen {
			t.Fatalf("%s: len=%d want %d", c.name, len(got), c.wantLen)
		}
		if c.wantFirstIndex >= 0 && got[0].Path != string(rune('a'+c.wantFirstIndex)) {
			t.Fatalf("%s: first=%q want index %d", c.name, got[0].Path, c.wantFirstIndex)
		}
	}
}
