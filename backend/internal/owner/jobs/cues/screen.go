// screen.go —— a phone screen: the owner's fixed script + the job loop's briefs. The script is
// the subjectivity note titled "Phone screen" (pay, authorization, notice: the answers every
// screen asks). Each brief is the picture of a job the owner applied to. A call locks onto the
// first applied job whose company the other side names, and stays locked.

package cues

import (
	"regexp"
	"strings"
)

const briefChars = 4000

var (
	scriptTitleRE = regexp.MustCompile(`(?i)^phone screen$`)
	// companySuffixRE —— company names drop these before matching what was heard: "Acme Inc."
	// is said "Acme".
	companySuffixRE = regexp.MustCompile(`(?i)[,.]?[` + jsSpace + `]+(inc|corp|corporation|ltd|` +
		`limited|llc|co|gmbh|technologies|labs)\.?$`)
	nonWordRE = regexp.MustCompile(`[^a-z0-9]+`)
)

// Job —— an applied job with a brief, as the ledger keeps it. It drives the "# This call" homework
// block; the tailored résumé is bound separately, by the session's code (cue-resume-grounding).
type Job struct {
	Company string `json:"company"`
	Title   string `json:"title"`
	Brief   string `json:"brief"`
}

// Resume —— the tailored résumé of the application the session's code is bound to, as the card's
// material shows it: the company it went to, the summary, the work entries and the skills lines
// (each "category: a, b"), already formatted by the port. The card leads background / fit /
// why-this-role answers from it (cue-resume-grounding).
type Resume struct {
	Company string
	Summary string
	Works   []ResumeWork
	Skills  []string
}

// ResumeWork —— one work entry of a tailored résumé, with its period already formatted.
type ResumeWork struct {
	Company string
	Title   string
	Period  string
	Bullets []string
}

// Screen —— the phone-screen material, read fresh for every question.
type Screen struct {
	Script string
	Jobs   []Job
}

// ScriptOf —— the first subjectivity note titled "Phone screen", as plain prose.
func ScriptOf(subjectivity []Note) string {
	for _, n := range subjectivity {
		if scriptTitleRE.MatchString(jsTrim(n.Title)) {
			return cleanBody(n.Body)
		}
	}
	return ""
}

// companies —— every applied job's company, in ledger order.
func (s Screen) companies() []string {
	out := make([]string, 0, len(s.Jobs))
	for _, j := range s.Jobs {
		out = append(out, j.Company)
	}
	return out
}

func spokenName(company string) string {
	return strings.ToLower(jsTrim(companySuffixRE.ReplaceAllString(company, "")))
}

// notice —— the index of the first job whose company the line names, or -1.
func (s Screen) notice(text string) int {
	said := " " + nonWordRE.ReplaceAllString(strings.ToLower(text), " ") + " "
	for i, j := range s.Jobs {
		name := spokenName(j.Company)
		if name == "" {
			continue
		}
		if strings.Contains(said, " "+jsTrim(nonWordRE.ReplaceAllString(name, " "))+" ") {
			return i
		}
	}
	return -1
}

// context —— the script, then the shown job's brief. The résumé (cue-resume-grounding) is prepended
// separately in deck.build, so it leads the posting without counting as the posting (hasPosting).
func (s Screen) context(show *Job) string {
	out := ""
	if s.Script != "" {
		out = "# Your phone screen script\nYour own answers. Use them as given for pay, work " +
			"authorization, notice and why you are looking.\n" + s.Script + "\n\n"
	}
	if show != nil && show.Brief != "" {
		title := ""
		if show.Title != "" {
			title = " — " + show.Title
		}
		out += "# This call: " + show.Company + title +
			"\nYour homework on this job. Lead with it.\n" +
			prefix16(show.Brief, briefChars) + "\n\n"
	}
	return out
}

// resumeHeader —— the lead-in on the résumé block: name the application and the quote-don't-invent
// rule (spec §2/§4: quote the résumé as written; what it does not say, say so, don't fill with
// generic lines).
const resumeHeader = "# Your résumé for this application: "

// render —— the tailored résumé as the card's material: summary, experience, skills, each quoted so
// a background / why-this-role answer can lead from it. "" when the résumé is empty.
func (r *Resume) render() string {
	var b strings.Builder
	b.WriteString(resumeHeader + r.Company + "\n")
	b.WriteString("The résumé you sent for this job. Quote these facts for background, " +
		"experience and why-this-role; do not add anything not written here.\n")
	if r.Summary != "" {
		b.WriteString("## Summary\n" + r.Summary + "\n")
	}
	if len(r.Works) > 0 {
		b.WriteString("## Experience\n")
		for i := range r.Works {
			b.WriteString(r.Works[i].render())
		}
	}
	if len(r.Skills) > 0 {
		b.WriteString("## Skills\n" + strings.Join(r.Skills, "\n") + "\n")
	}
	return jsTrim(b.String())
}

func (w ResumeWork) render() string {
	period := ""
	if w.Period != "" {
		period = " (" + w.Period + ")"
	}
	var b strings.Builder
	b.WriteString("### " + w.Title + ", " + w.Company + period + "\n")
	for _, bullet := range w.Bullets {
		b.WriteString("- " + bullet + "\n")
	}
	return b.String()
}

// isEmpty —— nothing to show (an application with a blank résumé): the card stays as it was.
func (r *Resume) isEmpty() bool {
	return r.Summary == "" && len(r.Works) == 0 && len(r.Skills) == 0
}

// renderCard —— the full background recap for the CARD itself (not the prompt context): the summary
// and EVERY experience, company/title/period/bullets. A background card must carry the whole résumé
// (卡片完整度 spec), so this is deterministic — the model's sampling can never drop an entry, which is
// what made coverage vary. No skills (material only, not an acceptance line) and no prompt
// instructions. "" when empty.
func (r *Resume) renderCard() string {
	if r.isEmpty() {
		return ""
	}
	var b strings.Builder
	b.WriteString("**Your background (from your résumé for " + r.Company + "):**\n")
	if r.Summary != "" {
		b.WriteString("## Summary\n" + r.Summary + "\n")
	}
	if len(r.Works) > 0 {
		b.WriteString("## Experience\n")
		for i := range r.Works {
			b.WriteString(r.Works[i].render())
		}
	}
	return jsTrim(b.String())
}
