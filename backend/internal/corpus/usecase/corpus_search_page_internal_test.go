package usecase

import "testing"

func rowsN(n int) []Meta {
	out := make([]Meta, 0, n)
	for i := range n {
		out = append(out, Meta{Path: string(rune('a' + i))})
	}
	return out
}

// The windows TestPageRowsCapsAndPages runs: corpus sizes, page sizes and offsets.
const (
	pastMaxRows  = 80  // more rows than the default page
	threePages   = 30  // three pages of 8 and a partial fourth
	tenRows      = 10  // more than one small page, far less than the offset past the end
	partialPages = 25  // pages of 20 leave a last page of 5
	smallPage    = 8   // an explicit limit under the default
	widePage     = 20  // the page that leaves partialPages a partial last page
	hugeLimit    = 999 // far over the maximum, so the clamp shows
	pastTheEnd   = 50  // an offset beyond every corpus here
)

// TestPageRowsCapsAndPages — the merged search returns up to four genres' hits at once; without a
// cap a broad query renders the whole corpus in one wall ("会炸的"). A zero limit caps at the
// default, a big limit is clamped, and offset pages through a stable order.
func TestPageRowsCapsAndPages(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name           string
		total          int
		offset, limit  int
		wantLen        int
		wantFirstIndex int // index into rowsN of the first returned row, -1 for empty
	}{
		{"zero limit caps at default", pastMaxRows, 0, 0, searchDefaultLimit, 0},
		{"explicit small limit", pastMaxRows, 0, smallPage, smallPage, 0},
		{"limit clamped to max", pastMaxRows, 0, hugeLimit, searchMaxLimit, 0},
		{"offset pages forward", threePages, smallPage, smallPage, smallPage, smallPage},
		{"offset past end is empty", tenRows, pastTheEnd, smallPage, 0, -1},
		{"last partial page", partialPages, widePage, widePage, partialPages - widePage, widePage},
		{"negative offset treated as zero", tenRows, -smallPage, smallPage, smallPage, 0},
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
