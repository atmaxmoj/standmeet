// draft_check.go —— what the server checks in a draft the owner's AI wrote (job-loop roadmap 5.1).
// The server never writes résumé content; it compares the draft with the owner's master and names
// every deviation that has bitten before: a changed title, company, period or contact; a work the
// master does not have; history out of newest-first order; and any immigration or
// work-authorization claim, which only the owner may make.
//
// Not findings: dropping a work, reordering or rewriting bullets, a new summary, the skills chosen.

package jobsmodel

import (
	_ "embed" // the immigration term list
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// Finding kinds.
const (
	FindingChanged     = "changed"
	FindingUnpaired    = "unpaired"
	FindingOrder       = "order"
	FindingImmigration = "immigration"
)

// Check coverage: whether a master was there to compare with.
const (
	CoverageMaster = "master"
	CoverageNone   = "none"
)

// Finding —— one deviation, named by its field.
type Finding struct {
	Key    string `json:"key"`
	Kind   string `json:"kind"`
	Master string `json:"master"`
	Draft  string `json:"draft"`
}

// DraftCheck —— a draft's findings, and whether there was a master to check it against.
type DraftCheck struct {
	Coverage string    `json:"coverage"`
	Findings []Finding `json:"findings"`
}

// immigrationTermList —— one term per line, en and zh (data, so the list grows without code).
//
//go:embed immigration_terms.txt
var immigrationTermList string

// immigrationTerms —— a draft states residence, citizenship or work authorization only when the
// owner says so. Latin terms match case-insensitively on word edges, others as written. A bare "PR"
// is not a term: "pull request (PR)" is how engineers write.
var immigrationTerms = termsRE(immigrationTermList)

func termsRE(list string) *regexp.Regexp {
	alts := make([]string, 0, strings.Count(list, "\n")+1)
	for t := range strings.SplitSeq(strings.TrimSpace(list), "\n") {
		q := regexp.QuoteMeta(strings.TrimSpace(t))
		if t[0] < utf8.RuneSelf {
			q = `\b` + q + `\b`
		}
		alts = append(alts, q)
	}
	return regexp.MustCompile(`(?i)` + strings.Join(alts, "|"))
}

// CheckDraft —— the draft against the master (nil = no reference: coverage none, and only the
// checks that need no master run).
func CheckDraft(master, draft *ResumeContent) DraftCheck {
	out := DraftCheck{Coverage: CoverageNone, Findings: []Finding{}}
	if master != nil {
		out.Coverage = CoverageMaster
		out.Findings = append(out.Findings, slices.Concat(
			identityFindings(&master.Identity, &draft.Identity),
			workFindings(master.Works, draft.Works),
			educationFindings(master.Educations, draft.Educations))...)
	}
	// append, not Concat: Concat of nothing is nil, and the receipt must say [] (never null).
	out.Findings = append(out.Findings,
		slices.Concat(orderFindings(draft), immigrationFindings(draft))...)
	return out
}

// Unaccepted —— the findings whose key is not in accept: what still blocks a commit.
func (c *DraftCheck) Unaccepted(accept []string) []Finding {
	out := []Finding{}
	for _, f := range c.Findings {
		if !slices.Contains(accept, f.Key) {
			out = append(out, f)
		}
	}
	return out
}

func changed(key, master, draft string) []Finding {
	if strings.TrimSpace(master) == strings.TrimSpace(draft) {
		return nil
	}
	return []Finding{{Key: key, Kind: FindingChanged, Master: master, Draft: draft}}
}

func identityFindings(m, d *ResumeIdentity) []Finding {
	return slices.Concat(
		changed("identity.name", m.Name, d.Name),
		changed("identity.email", m.Email, d.Email),
		changed("identity.phone", m.Phone, d.Phone),
	)
}

func workFindings(master, draft []ResumeWork) []Finding {
	var out []Finding
	for i := range draft {
		key := fmt.Sprintf("works[%d]", i)
		m := pairWork(master, &draft[i])
		if m == nil {
			out = append(out, Finding{Key: key, Kind: FindingUnpaired, Draft: workLine(&draft[i])})
			continue
		}
		out = slices.Concat(out,
			changed(key+".title", m.Title, draft[i].Title),
			changed(key+".company", m.Company, draft[i].Company),
			changed(key+".period", periodLine(m.Period), periodLine(draft[i].Period)))
	}
	return out
}

// pairWork —— the master work a draft work stands for: same company and start month, else the
// same start month.
func pairWork(master []ResumeWork, d *ResumeWork) *ResumeWork {
	i := indexWork(master, func(m *ResumeWork) bool {
		return m.Period.Start == d.Period.Start && sameName(m.Company, d.Company)
	})
	if i < 0 {
		i = indexWork(master, func(m *ResumeWork) bool { return m.Period.Start == d.Period.Start })
	}
	if i < 0 {
		return nil
	}
	return &master[i]
}

func indexWork(works []ResumeWork, match func(*ResumeWork) bool) int {
	for i := range works {
		if match(&works[i]) {
			return i
		}
	}
	return -1
}

func educationFindings(master, draft []ResumeEducation) []Finding {
	var out []Finding
	for i := range draft {
		key := fmt.Sprintf("educations[%d]", i)
		j := slices.IndexFunc(master, func(m ResumeEducation) bool {
			return sameName(m.School, draft[i].School)
		})
		if j < 0 {
			out = append(out, Finding{Key: key, Kind: FindingUnpaired, Draft: draft[i].School})
			continue
		}
		out = slices.Concat(out,
			changed(key+".degree", master[j].Degree, draft[i].Degree),
			changed(key+".period", periodLine(master[j].Period), periodLine(draft[i].Period)))
	}
	return out
}

// orderFindings —— works and educations read newest first.
func orderFindings(d *ResumeContent) []Finding {
	works := make([]string, 0, len(d.Works))
	for i := range d.Works {
		works = append(works, d.Works[i].Period.Start)
	}
	edus := make([]string, 0, len(d.Educations))
	for i := range d.Educations {
		edus = append(edus, d.Educations[i].Period.Start)
	}
	return slices.Concat(orderFinding("works", works), orderFinding("educations", edus))
}

func orderFinding(key string, starts []string) []Finding {
	newest := func(a, b string) int { return strings.Compare(b, a) }
	if slices.IsSortedFunc(starts, newest) {
		return nil
	}
	return []Finding{{Key: key, Kind: FindingOrder, Draft: strings.Join(starts, ", ")}}
}

// immigrationFindings —— every text field the recruiter reads.
func immigrationFindings(d *ResumeContent) []Finding {
	fields := textFields(d)
	for i := range d.Skills {
		fields = append(fields, textField{
			fmt.Sprintf("skills[%d]", i),
			strings.Join(d.Skills[i].Items, ", "),
		})
	}
	for i := range d.Custom {
		fields = append(fields, textField{
			fmt.Sprintf("custom[%d]", i),
			d.Custom[i].Label + ": " + d.Custom[i].Value,
		})
	}
	var out []Finding
	for _, f := range fields {
		if immigrationTerms.MatchString(f.text) {
			out = append(out, Finding{Key: f.key, Kind: FindingImmigration, Draft: f.text})
		}
	}
	return out
}

func sameName(a, b string) bool {
	return strings.EqualFold(strings.TrimSpace(a), strings.TrimSpace(b))
}

func workLine(w *ResumeWork) string {
	return w.Title + " · " + w.Company + " · " + periodLine(w.Period)
}

func periodLine(p ResumePeriod) string {
	end := "present"
	if p.End != nil && *p.End != "" {
		end = *p.End
	}
	return p.Start + " – " + end
}
