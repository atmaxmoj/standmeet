// seen.go —— the owner's seen ledger (job-loop roadmap 4.1, E8): every posting a board or Job Scout
// showed, what the owner did with it, and what the owner's AI made of it.

package jobsmodel

import (
	"errors"
	"time"
)

// Ledger statuses.
const (
	SeenStatusSeen      = "seen"
	SeenStatusDiscarded = "discarded"
	SeenStatusApplied   = "applied"
)

// FlagDoNotApply —— a posting from a company the owner marked (4.1.e).
const FlagDoNotApply = "do_not_apply"

// Annotations —— the owner's AI's assessment of a posting (4.1.d, 8.2.a). Kept on the ledger row,
// never in anything a recruiter's agent reads.
type Annotations struct {
	Score            *float64    `json:"score,omitempty"`
	Reason           string      `json:"reason,omitempty"`
	Deductions       []Deduction `json:"deductions,omitempty"`
	CitedNotes       []string    `json:"cited_notes,omitempty"`
	Flags            []string    `json:"flags,omitempty"`
	InterviewReports []string    `json:"interview_reports,omitempty"`
}

// Deduction —— one point off, and why.
type Deduction struct {
	Why    string  `json:"why"`
	Points float64 `json:"points"`
}

// SeenRow —— one ledger row.
type SeenRow struct {
	FirstSeenAt   time.Time
	LastSeenAt    time.Time
	ApplicationID *string
	Annotations   Annotations
	ID            string
	Status        string
	Source        string
	Snapshot      FetchedJob
}

// Recorded —— what jobs.record says about one posting: its row, and whether it was new.
type Recorded struct {
	FirstSeenAt time.Time `json:"first_seen_at"`
	ID          string    `json:"job_seen_id"`
	Status      string    `json:"status"`
	New         bool      `json:"new"`
}

// SeenFilter —— jobs.history's narrowing: [From, To) on first_seen_at, and a status. Zero = none.
type SeenFilter struct {
	From   time.Time
	To     time.Time
	Status string
}

// ErrSeenNotFound —— no ledger row of this owner's with that id.
var ErrSeenNotFound = errors.New("no such posting in the job ledger")

// ErrCompanyMarked —— drafting for a company the owner marked do_not_apply, without override.
var ErrCompanyMarked = errors.New("the company is marked do_not_apply")
