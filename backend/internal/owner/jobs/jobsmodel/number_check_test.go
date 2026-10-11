package jobsmodel_test

import (
	"slices"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// TestCheckNumbersClaims —— what reads as a claim, and what must not (roadmap 5.2): years,
// durations and numbers glued into names are not claims. Against an empty master every claim is
// unsupported, so the list is exactly what was read.
func TestCheckNumbersClaims(t *testing.T) {
	t.Parallel()
	cases := map[string][]string{
		"Cut p99 latency by 40% in 2021, over 2 years 11 months.": {"40%"},
		"top-1 38% → 71% over nine months":                        {"38%", "71%"},
		"Grew revenue 3x to $1.2M across 12 teams":                {"3x", "1.2M", "12"},
		"Shipped an H1B form, GPT-4 evals and ES2015 modules":     nil,
		"Served 40 % of traffic":                                  {"40%"},
	}
	for text, want := range cases {
		draft := jobsmodel.ResumeContent{Summary: text}
		got := make([]string, 0, len(want))
		for _, c := range jobsmodel.CheckNumbers(&jobsmodel.ResumeContent{}, &draft).Unsupported {
			got = append(got, c.Claim)
		}
		if !slices.Equal(got, append([]string{}, want...)) {
			t.Errorf("claims in %q = %q, want %q", text, got, want)
		}
	}
}
