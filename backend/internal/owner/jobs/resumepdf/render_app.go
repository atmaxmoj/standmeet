package resumepdf

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

// RenderApplicationPDF —— satisfies jobsuc.PDFRenderer. Pulls the résumé content, the target job
// (role = job title, company), and the chosen template off the application, and passes the
// server-built qrURL straight through (the owner never sets it).
func (r Renderer) RenderApplicationPDF(
	ctx context.Context, app *jobsmodel.Application, qrURL string,
) ([]byte, error) {
	return r.Render(ctx, &app.ResumeContent, RenderOptions{
		Template: app.Template,
		Role:     app.JobSnapshot.Title,
		Company:  app.JobSnapshot.Company,
		QRURL:    qrURL,
	})
}
