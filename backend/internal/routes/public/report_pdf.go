// report_pdf.go —— GET /api/v1/report/{id}/pdf
//
// Renders one chat report's HTML into a downloadable PDF. Reuses report.go's
// owner-scoped fetch; wraps the HTML body fragment into a complete document + a plain
// print stylesheet, renders it through gotenberg's /forms/chromium/convert/html, and
// returns it as an application/pdf attachment.
//
// A report is simple HTML (h1/h2/p/ul), so convert/html renders it directly — this
// skips the résumé's print-page + printsess + convert/url React rendering chain.
//
// When no renderer is configured (NoopClient → ErrNotConfigured), returns 503 + a
// human-readable error, with no stack trace leaking.

package public

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	conversation "github.com/atmaxmoj/standmeet/internal/conversation/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
	"github.com/atmaxmoj/standmeet/internal/infra/gotenberg"
)

// ReportPDFRenderer —— a narrow interface for rendering a complete HTML doc into PDF
// bytes (satisfied by both gotenberg.Client and NoopClient). Defined in the public
// package to avoid a routes → gotenberg architecture dependency; wireup injects the
// concrete implementation.
type ReportPDFRenderer interface {
	RenderHTML(ctx context.Context, htmlDoc string) ([]byte, error)
}

func (h *Handlers) getReportPDF() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		dispatchGetReportPDF(h, w, r)
	}
}

func dispatchGetReportPDF(h *Handlers, w http.ResponseWriter, r *http.Request) {
	av, ok := authVisitorWithToken(h, w, r)
	if !ok {
		return
	}
	pdf, err := renderReportPDF(h, r, av.Data.OwnerID, av.Data.MemberID)
	if err != nil {
		handleReportPDFErr(h, w, err)
		return
	}
	writeReportPDF(h, w, chi.URLParam(r, "id"), pdf)
}

// renderReportPDF —— member-scoped fetch (#170) + gotenberg HTML→PDF. Errors
// (not-found / not-configured / render) propagate as-is, routed by
// handleReportPDFErr.
func renderReportPDF(h *Handlers, r *http.Request, ownerID, memberID string) ([]byte, error) {
	report, ferr := fetchOwnedReport(h, r, chi.URLParam(r, "id"), ownerID, memberID)
	if ferr != nil {
		return nil, ferr
	}
	return h.PDFRenderer.RenderHTML(r.Context(), wrapReportHTML(&report))
}

func writeReportPDF(h *Handlers, w http.ResponseWriter, id string, pdf []byte) {
	w.Header().Set("Content-Type", "application/pdf")
	disposition := fmt.Sprintf("attachment; filename=%q", "report-"+id+".pdf")
	w.Header().Set("Content-Disposition", disposition)
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(pdf); err != nil {
		h.Log.Error("write report pdf", "err", err)
	}
}

func handleReportPDFErr(h *Handlers, w http.ResponseWriter, err error) {
	if errors.Is(err, conversation.ErrReportNotFound) {
		writeError(h.Log, w, reportNotFoundEnv())
		return
	}
	if errors.Is(err, gotenberg.ErrNotConfigured) {
		writeError(h.Log, w, apierr.Envelope{
			Status:  http.StatusServiceUnavailable,
			Code:    "pdf_unavailable",
			Message: "PDF download isn't available on this instance right now.",
		})
		return
	}
	h.Log.Error("render report pdf", "err", err)
	writeError(h.Log, w, serverErr())
}

// wrapReportHTML —— report.HTML → gotenberg-ready doc. New reports are stored as the ONE
// self-contained styled document (sanitized-then-styled at generation), so render AS-IS — re-
// sanitizing would strip the trusted <style>, and re-wrapping double-nests it. A legacy bare
// fragment (pre-unification) is sanitized + styled through the same `ReportStyledDocument` the
// card/page use, so the PDF matches them instead of carrying its own divergent stylesheet.
func wrapReportHTML(report *conversation.ChatReport) string {
	if conversation.IsFullReportDocument(report.HTML) {
		return report.HTML
	}
	return conversation.ReportStyledDocument(conversation.SanitizeReportHTML(report.HTML))
}
