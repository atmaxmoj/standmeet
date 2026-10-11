// direct_source.go —— a company's own board, read off a posting link (job-loop roadmap 4.3.d). An
// aggregator that links to the company's ATS tells the owner a source they can register directly:
// fresher, complete, and with the board's own form.

package jobsmodel

import (
	"cmp"
	"regexp"
	"slices"
	"strings"
)

// DirectSource —— one board to register: the kind and company jobs.register_source takes, and how
// many postings in the ledger link to it.
type DirectSource struct {
	Kind     string `json:"kind"`
	Company  string `json:"company"`
	Postings int    `json:"postings"`
}

var atsLinks = []struct {
	re   *regexp.Regexp
	kind string
}{
	{
		regexp.MustCompile(`^https?://(?:job-)?boards(?:-api)?\.greenhouse\.io/` +
			`(?:v1/boards/)?([\w-]+)`),
		"greenhouse",
	},
	{regexp.MustCompile(`^https?://jobs\.(?:eu\.)?lever\.co/([\w-]+)`), "lever"},
	{regexp.MustCompile(`^https?://jobs\.ashbyhq\.com/([\w.-]+)`), "ashby"},
}

// DirectSourceOf —— the ATS board a posting link points at; false for any other link.
func DirectSourceOf(url string) (DirectSource, bool) {
	for _, l := range atsLinks {
		if m := l.re.FindStringSubmatch(url); m != nil {
			return DirectSource{Kind: l.kind, Company: strings.ToLower(m[1])}, true
		}
	}
	return DirectSource{}, false
}

// SuggestDirectSources —— the boards the links point at, minus the ones registered (keyed
// kind/company), most postings first.
func SuggestDirectSources(urls []string, registered map[string]bool) []DirectSource {
	counts := map[DirectSource]int{}
	for _, u := range urls {
		if s, ok := DirectSourceOf(u); ok && !registered[s.Kind+"/"+s.Company] {
			counts[s]++
		}
	}
	out := make([]DirectSource, 0, len(counts))
	for s, n := range counts {
		s.Postings = n
		out = append(out, s)
	}
	slices.SortFunc(out, func(a, b DirectSource) int {
		return cmp.Or(b.Postings-a.Postings, strings.Compare(a.Company, b.Company))
	})
	return out
}
