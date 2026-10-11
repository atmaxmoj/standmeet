// doctor.go —— workflow.doctor (job-loop roadmap 6.3): one call says what the job loop is missing
// before it can work well. Three facts: the cv note the hiring role grounds on, a résumé master the
// drafts start from, and a "Looking for" note the owner's AI ranks postings against.

package jobsuc

import (
	"context"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/infra/paging"
)

// DoctorItem —— one missing piece, and how to supply it.
type DoctorItem struct {
	Item string `json:"item"`
	Fix  string `json:"fix"`
}

// DoctorReport —— what is missing; ready when nothing is.
type DoctorReport struct {
	Missing []DoctorItem `json:"missing"`
	Ready   bool         `json:"ready"`
}

// The notes the job loop reads, by the slug their title makes.
const (
	cvNoteURI         = "subjectivity://cv"
	lookingForNoteURI = "subjectivity://looking-for"
)

// Doctor —— the job loop's missing pieces for this owner.
func Doctor(ctx context.Context, deps *ApplicationsDeps, ownerID string) (DoctorReport, error) {
	masters, err := deps.Masters.ListPage(ctx, ownerID, paging.Request{Limit: 1})
	if err != nil {
		return DoctorReport{}, fmt.Errorf("doctor: masters: %w", err)
	}
	out := DoctorReport{Missing: []DoctorItem{}}
	if !deps.CVCheck.Exists(ctx, ownerID, cvNoteURI) {
		out.Missing = append(out.Missing, DoctorItem{Item: "cv", Fix: "Write a subjectivity note " +
			"titled \"cv\" with subjectivity_write: employers, titles and dates. The recruiter's " +
			"agent answers employment questions from it."})
	}
	if len(masters.Items) == 0 {
		out.Missing = append(out.Missing, DoctorItem{Item: "master", Fix: "Create a résumé " +
			"master with resume.master_create (is_default: true). Drafts start from it."})
	}
	if !deps.CVCheck.Exists(ctx, ownerID, lookingForNoteURI) {
		out.Missing = append(out.Missing, DoctorItem{Item: "looking_for", Fix: "Write a " +
			"subjectivity note titled \"Looking for\" with subjectivity_write: roles, level, " +
			"location and what rules a posting out. Postings are ranked against it."})
	}
	out.Ready = len(out.Missing) == 0
	return out, nil
}
