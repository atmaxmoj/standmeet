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

// Job —— an applied job with a brief, as the ledger keeps it.
type Job struct {
	Company string `json:"company"`
	Title   string `json:"title"`
	Brief   string `json:"brief"`
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

// context —— the script, then the locked job's brief, ahead of everything else.
func (s Screen) context(locked *Job) string {
	out := ""
	if s.Script != "" {
		out = "# Your phone screen script\nYour own answers. Use them as given for pay, work " +
			"authorization, notice and why you are looking.\n" + s.Script + "\n\n"
	}
	if locked != nil {
		title := ""
		if locked.Title != "" {
			title = " — " + locked.Title
		}
		out += "# This call: " + locked.Company + title +
			"\nYour homework on this job. Lead with it.\n" +
			prefix16(locked.Brief, briefChars) + "\n\n"
	}
	return out
}
