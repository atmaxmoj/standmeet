// repo_application_resume.go — editing a committed application's tailored résumé (the one the cue
// card reads). Split out of repo_applications.go, which stays focused on the Commit transaction.

package jobsuc

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/atmaxmoj/standmeet/internal/infra/pgstore"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsuc/db"
)

// UpdateResume — replace a committed application's tailored résumé (owner-scoped). The cue card
// reads resume_content live (no deck cache), so an edit shows on the next card; the already-sent
// PDF is not re-rendered. A missing or wrong-owner id → ErrApplicationNotFound, never a no-op.
// (UUIDOrNull: a malformed id becomes a null UUID that matches no row → the same not-found.)
func (r *ApplicationRepo) UpdateResume(
	ctx context.Context, ownerID, appID string, resume *jobsmodel.ResumeContent,
) error {
	content, err := json.Marshal(resume)
	if err != nil {
		return fmt.Errorf("marshal resume content: %w", err)
	}
	_, err = db.New(r.pool).UpdateApplicationResume(ctx, db.UpdateApplicationResumeParams{
		ResumeContent: content,
		ID:            pgstore.UUIDOrNull(appID),
		OwnerID:       pgstore.UUIDOrNull(ownerID),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return jobsmodel.ErrApplicationNotFound
	}
	if err != nil {
		return fmt.Errorf("update application resume: %w", err)
	}
	return nil
}
