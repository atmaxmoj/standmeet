// interview.go —— a practice interview's two touch points with the ledger
// (docs/design/deepinterview-engine.md): the packet the engine is fed, and the report that comes
// back onto the posting's row.

package jobsuc

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// ScopeNotesFunc —— the owner's notes in an interview's scope, given the assessment's cited notes.
type ScopeNotesFunc func(ctx context.Context, ownerID string, cited []string) (
	[]jobsmodel.ScopeNote, error)

// InterviewDeps —— the ledger, and a narrow port into the corpus wired at the composition root:
// the owner's notes in an interview's scope (the cv, each project root note, each cited note).
type InterviewDeps struct {
	Seen       *JobSeenRepo
	ScopeNotes ScopeNotesFunc
}

// InterviewPacket —— jobs.interview_packet. A cleared row has nothing to interview on.
func InterviewPacket(
	ctx context.Context, d *InterviewDeps, ownerID, seenID string,
) (jobsmodel.Packet, error) {
	row, err := d.Seen.Get(ctx, ownerID, seenID)
	if err != nil {
		return jobsmodel.Packet{}, err
	}
	if row.ClearedAt != nil {
		return jobsmodel.Packet{}, jobsmodel.ErrAssessmentCleared
	}
	notes, err := d.ScopeNotes(ctx, ownerID, row.Annotations.CitedNotes)
	if err != nil {
		return jobsmodel.Packet{}, fmt.Errorf("interview scope notes: %w", err)
	}
	return jobsmodel.PacketOf(&row, notes)
}

// AddInterviewReport —— jobs.add_interview_report: one report appended to the row, which counts
// as a touch of its retention clock. A cleared row refuses.
func AddInterviewReport(
	ctx context.Context, d *InterviewDeps, ownerID, seenID, report string,
) error {
	if strings.TrimSpace(report) == "" {
		return jobsmodel.ErrEmptyReport
	}
	return d.Seen.AppendReport(ctx, ownerID, seenID, report)
}

// AppendReport —— the append, refused on a missing or cleared row, with the clock's touch.
func (r *JobSeenRepo) AppendReport(ctx context.Context, ownerID, seenID, report string) error {
	k := seenKey{id: pgstore.UUIDOrNull(seenID), owner: pgstore.UUIDOrNull(ownerID)}
	return pgstore.InTx(ctx, r.pool, func(tx pgstore.Tx) error {
		q := db.New(tx)
		if _, err := clockState(ctx, q, k); err != nil {
			return err
		}
		err := q.AppendInterviewReport(ctx, db.AppendInterviewReportParams{
			Report: report, ID: k.id, OwnerID: k.owner,
		})
		if err != nil {
			return fmt.Errorf("append interview report: %w", err)
		}
		return q.TouchSeenBundle(ctx, db.TouchSeenBundleParams{ID: k.id, OwnerID: k.owner})
	})
}
