// applications_label_internal_test.go — applicationCodeLabel is owner-facing UI text (the codes
// panel / sidebar tag), so it must carry the posting's PLAIN title/company, never the
// <untrusted-content> fence the recruiter prompt uses. That fence once leaked into the label
// ("app · <untrusted-content source=\"job posting\">…</untrusted-content> at …") and broke the
// codes card layout. Internal test: applicationCodeLabel/plainField are unexported.

package jobsuc

import (
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

func TestApplicationCodeLabelIsPlain(t *testing.T) {
	t.Parallel()
	got := applicationCodeLabel(&jobsmodel.FetchedJob{
		Title:   "Senior Software Engineer, Inference",
		Company: "AssemblyAI",
	})
	if strings.Contains(got, "untrusted-content") || strings.Contains(got, "<") {
		t.Fatalf("label carries a prompt fence: %q", got)
	}
	want := applicationCodePrefix + " · Senior Software Engineer, Inference at AssemblyAI"
	if got != want {
		t.Fatalf("label = %q, want %q", got, want)
	}
}

func TestApplicationCodeLabelCapsLongTitle(t *testing.T) {
	t.Parallel()
	got := applicationCodeLabel(&jobsmodel.FetchedJob{
		Title:   strings.Repeat("x", 200),
		Company: "Co",
	})
	if title, _, _ := strings.Cut(strings.TrimPrefix(got, applicationCodePrefix+" · "),
		" at "); len([]rune(title)) > labelFieldMax+1 {
		t.Fatalf("title field not length-capped: %d runes (%q)", len([]rune(title)), got)
	}
	if !strings.Contains(got, "…") {
		t.Fatalf("long title not truncated: %q", got)
	}
}

func TestApplicationCodeLabelSingleLinesField(t *testing.T) {
	t.Parallel()
	got := applicationCodeLabel(&jobsmodel.FetchedJob{
		Title:   "Staff\nEngineer",
		Company: "  Acme  ",
	})
	if strings.ContainsAny(got, "\n\r") {
		t.Fatalf("label kept a line break: %q", got)
	}
	want := applicationCodePrefix + " · Staff Engineer at Acme"
	if got != want {
		t.Fatalf("label = %q, want %q", got, want)
	}
}
