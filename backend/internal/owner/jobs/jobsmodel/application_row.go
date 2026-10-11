// application_row.go —— an application as the owner's surfaces show it (admin list and detail,
// MCP applications.*): one shape for both faces.

package jobsmodel

import "time"

// ApplicationRow —— one application in a list. OpenedAt is null until the recruiter first opened
// the code; Questions counts what they asked across its conversations.
type ApplicationRow struct {
	// SubmittedAt —— the zero time while the application was never sent (the panel's schema reads
	// a string; the zero time is its "not yet").
	SubmittedAt time.Time  `json:"submitted_at"`
	CreatedAt   time.Time  `json:"created_at"`
	OpenedAt    *time.Time `json:"opened_at"`
	ID          string     `json:"id"`
	Company     string     `json:"company"`
	Role        string     `json:"role"`
	Status      string     `json:"status"`
	Outcome     string     `json:"outcome"`
	// Followup —— due, cold or "" (roadmap 3.1.c).
	Followup      string        `json:"followup"`
	ResumeContent ResumeContent `json:"resume_content"`
	Questions     int           `json:"questions"`
}

// RowOf —— the row of an application.
func RowOf(a *Application) ApplicationRow {
	row := ApplicationRow{
		ID: a.ID, Company: a.JobSnapshot.Company, Role: a.JobSnapshot.Title,
		Status: a.Status, Outcome: a.Outcome, CreatedAt: a.CreatedAt,
		OpenedAt: a.OpenedAt, Questions: a.Questions, ResumeContent: a.ResumeContent,
		Followup: FollowupState(a, time.Now()),
	}
	if a.SubmittedAt != nil {
		row.SubmittedAt = *a.SubmittedAt
	}
	return row
}

// OutcomeRow —— one line of the outcome timeline, as the surfaces show it.
type OutcomeRow struct {
	CreatedAt   time.Time `json:"created_at"`
	FromOutcome string    `json:"from_outcome"`
	ToOutcome   string    `json:"to_outcome"`
	Note        string    `json:"note"`
}

// OutcomeRowsOf —— the timeline as rows (never null).
func OutcomeRowsOf(entries []OutcomeEntry) []OutcomeRow {
	out := make([]OutcomeRow, 0, len(entries))
	for i := range entries {
		out = append(out, OutcomeRow{
			CreatedAt: entries[i].CreatedAt, FromOutcome: entries[i].From,
			ToOutcome: entries[i].To, Note: entries[i].Note,
		})
	}
	return out
}
