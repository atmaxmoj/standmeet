// freshness.go —— is a posting fresh and real (job-loop roadmap 4.2): its age, and signals read
// from its text. Signals are flags, never filters: a flagged posting stays, and the owner's AI says
// why it is suspicious.

package jobsmodel

import (
	"regexp"
	"time"
)

// Content flags.
const (
	FlagShortener          = "shortener"
	FlagLocationRestricted = "location-restricted"
)

// Liveness, as a board answers it before drafting (4.2.b). Unknown is not closed.
const (
	LivenessOpen    = "open"
	LivenessClosed  = "closed"
	LivenessUnknown = "unknown"
)

// PublishedWithin —— the postings published in the last maxAgeDays days; undated ones pass, and 0
// keeps everything (4.2.a).
func PublishedWithin(jobs []FetchedJob, maxAgeDays int, now time.Time) []FetchedJob {
	if maxAgeDays <= 0 {
		return jobs
	}
	cutoff := now.AddDate(0, 0, -maxAgeDays)
	out := make([]FetchedJob, 0, len(jobs))
	for i := range jobs {
		if jobs[i].PublishedAt.IsZero() || !jobs[i].PublishedAt.Before(cutoff) {
			out = append(out, jobs[i])
		}
	}
	return out
}

var contentRules = []struct {
	re   *regexp.Regexp
	flag string
}{
	// A link shortener hides where an apply link goes: a scam's habit (4.2.c).
	{
		regexp.MustCompile(`(?i)\b(bit\.ly|tinyurl\.com|t\.co|goo\.gl|rb\.gy|` +
			`cutt\.ly|is\.gd|ow\.ly)/`),
		FlagShortener,
	},
	// Eligibility by country or region (4.2.d).
	{regexp.MustCompile(`(?i)\b(US|U\.S\.|USA|UK|EU|Canada|EMEA)[- ]only\b|` +
		`must (be )?(located|based|reside) in\b|residents? only\b`), FlagLocationRestricted},
}

// ContentFlags —— the signals a posting's own text carries.
func ContentFlags(j *FetchedJob) []string {
	text := j.Title + "\n" + j.Location + "\n" + j.BodyText
	var out []string
	for _, r := range contentRules {
		if r.re.MatchString(text) {
			out = append(out, r.flag)
		}
	}
	return out
}
