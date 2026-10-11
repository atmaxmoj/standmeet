// repo_company_marks.go —— companies the owner will not apply to (job-loop roadmap 4.1.e), keyed on
// the dedup layer's normalized name. A posting's flag is derived from here when it is read.

package jobsuc

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/dedup"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// MarkCompany —— sets (do_not_apply) or clears (none) the owner's mark on a company.
func (r *JobSeenRepo) MarkCompany(ctx context.Context, ownerID string, m *CompanyMark) error {
	q, owner, key := db.New(r.pool), pgstore.UUIDOrNull(ownerID), dedup.CompanyKey(m.Company)
	var err error
	if m.Mark == jobsmodel.FlagDoNotApply {
		err = q.UpsertCompanyMark(ctx, db.UpsertCompanyMarkParams{
			OwnerID: owner, CompanyKey: key, Mark: m.Mark, Note: m.Note,
		})
	} else {
		err = q.DeleteCompanyMark(ctx, db.DeleteCompanyMarkParams{OwnerID: owner, CompanyKey: key})
	}
	if err != nil {
		return fmt.Errorf("company mark: %w", err)
	}
	return nil
}

// FlagMarked —— each posting from a marked company gets the do_not_apply flag. Read on every read,
// so clearing a mark clears its flags at once.
func (r *JobSeenRepo) FlagMarked(
	ctx context.Context, ownerID string, jobs []*jobsmodel.FetchedJob,
) error {
	keys, err := db.New(r.pool).ListCompanyMarks(ctx, pgstore.UUIDOrNull(ownerID))
	if err != nil {
		return fmt.Errorf("company marks: %w", err)
	}
	marked := make(map[string]bool, len(keys))
	for _, k := range keys {
		marked[k] = true
	}
	for _, j := range jobs {
		j.Flags = jobsmodel.ContentFlags(j)
		if marked[dedup.CompanyKey(j.Company)] {
			j.Flags = append(j.Flags, jobsmodel.FlagDoNotApply)
		}
	}
	return nil
}
