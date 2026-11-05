// applications_pdf.go — re-render a committed application's final résumé PDF on demand.
//
// The 下载口子 spec: the final PDF appeared once, in applications.commit's result, and nothing stores
// it (the applications table has no PDF column). But the committed row carries the whole résumé
// (resume_content + job_snapshot) and the application's access code is stored plaintext, so the PDF
// is reproducible from the row — the same bytes commit printed, QR and all. The direction is
// re-render on demand, not store. Pure read: no new row, no new code, no state change.

package jobsuc

import (
	"context"
	"fmt"

	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// RenderCommittedPDF — a committed application's final PDF, re-rendered now from its stored row.
// ErrApplicationNotFound for an id that is not this owner's. The GUI download button and the
// agent's applications.resume_pdf both call this, so the two faces return the same PDF.
func RenderCommittedPDF(
	ctx context.Context, repo *ApplicationRepo, deps *ApplicationsDeps, ownerID, appID string,
) ([]byte, error) {
	app, err := repo.GetByID(ctx, ownerID, appID)
	if err != nil {
		return nil, err
	}
	publicURL, err := ownerPublicURL(ctx, deps, ownerID)
	if err != nil {
		return nil, err
	}
	code, err := committedCode(ctx, deps, ownerID, app.AccessCodeID)
	if err != nil {
		return nil, err
	}
	// ID shapes only the print URL; no Template — commit rendered with the fixed layout too.
	return deps.Renderer.RenderApplicationPDF(ctx, &jobsmodel.Application{
		ID: app.ID, ResumeContent: app.ResumeContent, JobSnapshot: app.JobSnapshot,
	}, BuildQRURL(publicURL, code))
}

// ownerPublicURL — the owner's public URL, the QR's host; ErrPublicURLNotSet when it is unset (the
// QR would be nonsense without it, as commit refuses too).
func ownerPublicURL(ctx context.Context, deps *ApplicationsDeps, ownerID string) (string, error) {
	o, err := deps.Owners.GetByID(ctx, ownerID)
	if err != nil {
		return "", err
	}
	if o.PublicURL == "" {
		return "", owner.ErrPublicURLNotSet
	}
	return o.PublicURL, nil
}

// committedCode — the application's own access code, plaintext, for the QR. Owner-scoped as defence
// in depth: the id came from this owner's row, but CodeLookup.GetByID is not owner-scoped.
func committedCode(
	ctx context.Context, deps *ApplicationsDeps, ownerID, codeID string,
) (string, error) {
	if deps.Codes == nil {
		return "", ErrCodeNotUsable
	}
	c, err := deps.Codes.GetByID(ctx, codeID)
	if err != nil {
		return "", fmt.Errorf("load application code: %w", err)
	}
	if c.OwnerID != ownerID {
		return "", jobsmodel.ErrApplicationNotFound
	}
	return c.Code, nil
}
