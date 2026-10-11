// export.go —— an application as a markdown file for the owner's vault (job-loop roadmap 7.5.a).
// One way: the instance writes it, the owner's agent saves it; nothing reads it back.

package jobsmodel

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

// ExportFile —— one file for the vault: a path relative to the vault root, and its text.
type ExportFile struct {
	Path     string `json:"path"`
	Markdown string `json:"markdown"`
}

var slugJunk = regexp.MustCompile(`[^a-z0-9]+`)

func exportSlug(s string) string {
	return strings.Trim(slugJunk.ReplaceAllString(strings.ToLower(s), "-"), "-")
}

// ApplicationMarkdown —— the application, its outcome timeline and the recruiter's questions.
func ApplicationMarkdown(a *ApplicationRow, outcomes []OutcomeRow, qs []Exchange) ExportFile {
	day := a.CreatedAt.UTC().Format(time.DateOnly)
	var b strings.Builder
	fmt.Fprintf(&b, "---\ncompany: %q\nrole: %q\napplied: %s\noutcome: %s\n---\n\n",
		a.Company, a.Role, day, a.Outcome)
	fmt.Fprintf(&b, "# %s — %s\n\n## Timeline\n\n- %s applied\n", a.Company, a.Role, day)
	for _, o := range outcomes {
		fmt.Fprintf(&b, "- %s %s → %s%s\n", o.CreatedAt.UTC().Format(time.DateOnly),
			o.FromOutcome, o.ToOutcome, noteSuffix(o.Note))
	}
	b.WriteString("\n## Their questions\n")
	for _, q := range qs {
		fmt.Fprintf(&b, "\n### %s\n\n%s\n", q.Question, q.Answer)
		if !q.Grounded {
			b.WriteString("\n_Gap: the corpus did not answer this._\n")
		}
	}
	name := fmt.Sprintf("%s-%s-%s.md", day, exportSlug(a.Company), exportSlug(a.Role))
	return ExportFile{Path: "applications/" + name, Markdown: b.String()}
}

func noteSuffix(note string) string {
	if note == "" {
		return ""
	}
	return " — " + note
}
