// usable_rows.go —— the rows every adapter hands back, made usable once at the registry (job-loop
// roadmap 4.3.a): decoded to plain text (readableJobs), a row with no link dropped and counted, a
// placeholder date cleared.

package fetch

import (
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// SkipUnusableRow —— the Skipped reason for a row with no link: nothing to apply to. A row with a
// link but no title stays — its body still says what the job is.
const SkipUnusableRow = "unusable_row"

// earliestPlausiblePost —— a posting date before this is a board's placeholder (the epoch), not
// a date; it is dropped to zero so it never reads as "very old".
var earliestPlausiblePost = time.Date(1990, 1, 1, 0, 0, 0, 0, time.UTC)

// usableJobs —— every adapter's rows pass here once: decoded to plain text, a row that cannot be
// applied to is dropped and counted, a placeholder date is cleared.
func usableJobs(acc Accounted) Accounted {
	jobs := readableJobs(acc.Jobs)
	kept := make([]jobsmodel.FetchedJob, 0, len(jobs))
	for i := range jobs {
		if jobs[i].URL == "" {
			acc.Skipped = countSkip(acc.Skipped, SkipUnusableRow)
			continue
		}
		if jobs[i].PublishedAt.Before(earliestPlausiblePost) {
			jobs[i].PublishedAt = time.Time{}
		}
		kept = append(kept, jobs[i])
	}
	acc.Jobs = kept
	return acc
}

func countSkip(m map[string]int, reason string) map[string]int {
	if m == nil {
		m = map[string]int{}
	}
	m[reason]++
	return m
}
