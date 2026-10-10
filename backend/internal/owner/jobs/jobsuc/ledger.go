// ledger.go —— the owner's seen ledger as use cases (job-loop roadmap 4.1, E8): what Job Scout
// records, what the owner's AI notes on a posting, the history by day, and company marks.

package jobsuc

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// maxRecord —— postings per jobs.record call. ponytail: one statement per posting; batch the
// inserts if Job Scout ever sends more.
const maxRecord = 200

// Ledger argument errors: the caller can fix each.
var (
	ErrNoPostings        = errors.New("postings: give at least one, at most 200")
	ErrPostingFields     = errors.New("each posting needs title, company and url")
	ErrBadDay            = errors.New("from / to: a day as YYYY-MM-DD")
	ErrBadStatus         = errors.New("status: one of seen, discarded, applied")
	ErrBadMark           = errors.New("mark: do_not_apply or none, with a company")
	ErrNothingToAnnotate = errors.New("job_seen_id is required")
)

// RecordPostings —— jobs.record (8.1.a): each posting into the ledger; the server dedups.
func RecordPostings(
	ctx context.Context, deps *JobsDeps, ownerID string, postings []jobsmodel.FetchedJob,
) ([]jobsmodel.Recorded, error) {
	if err := checkPostings(postings); err != nil {
		return nil, err
	}
	return deps.Seen.Record(ctx, ownerID, "record:"+uuid.NewString(), postings)
}

func checkPostings(postings []jobsmodel.FetchedJob) error {
	if len(postings) == 0 || len(postings) > maxRecord {
		return ErrNoPostings
	}
	for i := range postings {
		if !postingComplete(&postings[i]) {
			return fmt.Errorf("%w (posting %d)", ErrPostingFields, i)
		}
	}
	return nil
}

func postingComplete(p *jobsmodel.FetchedJob) bool {
	return p.Title != "" && p.Company != "" && p.URL != ""
}

// AnnotatePosting —— jobs.annotate (4.1.d, 8.2.a).
func AnnotatePosting(
	ctx context.Context, deps *JobsDeps, ownerID, id string, a *jobsmodel.Annotations,
) (jobsmodel.SeenRow, error) {
	if id == "" {
		return jobsmodel.SeenRow{}, ErrNothingToAnnotate
	}
	return deps.Seen.Annotate(ctx, ownerID, id, a)
}

// History —— jobs.history (8.3.a).
func History(
	ctx context.Context, deps *JobsDeps, ownerID string, f *jobsmodel.SeenFilter,
	req paging.Request,
) (paging.Page[jobsmodel.SeenRow], error) {
	return deps.Seen.Page(ctx, ownerID, f, req)
}

// SeenFilterOf —— jobs.history's arguments: inclusive UTC days, and a status.
func SeenFilterOf(from, to, status string) (jobsmodel.SeenFilter, error) {
	var f jobsmodel.SeenFilter
	var err error
	if f.From, err = day(from); err != nil {
		return f, err
	}
	if f.To, err = day(to); err != nil {
		return f, err
	}
	if !f.To.IsZero() {
		f.To = f.To.AddDate(0, 0, 1)
	}
	switch status {
	case "", jobsmodel.SeenStatusSeen, jobsmodel.SeenStatusDiscarded, jobsmodel.SeenStatusApplied:
		f.Status = status
		return f, nil
	}
	return f, ErrBadStatus
}

func day(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return time.Time{}, ErrBadDay
	}
	return t, nil
}

// CompanyMark —— jobs.mark_company's arguments.
type CompanyMark struct {
	Company string `json:"company"`
	Mark    string `json:"mark"`
	Note    string `json:"note"`
}

// MarkCompany —— jobs.mark_company (4.1.e): do_not_apply sets the mark, none clears it.
func MarkCompany(ctx context.Context, deps *JobsDeps, ownerID string, m *CompanyMark) error {
	m.Company = strings.TrimSpace(m.Company)
	if m.Company == "" || (m.Mark != jobsmodel.FlagDoNotApply && m.Mark != "none") {
		return ErrBadMark
	}
	return deps.Seen.MarkCompany(ctx, ownerID, m)
}
