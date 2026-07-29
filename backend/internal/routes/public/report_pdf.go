// report_pdf.go —— GET /api/v1/report/{id}/pdf
//
// 把一份 chat report 的 HTML 渲成 PDF 下载。复用 report.go 的 owner-scoped
// fetch；HTML body fragment 包成完整 doc + 朴素打印样式，经 gotenberg
// /forms/chromium/convert/html 渲 PDF，回 application/pdf attachment。
//
// 报告是简单 HTML（h1/h2/p/ul），用 convert/html 直渲即可，不走简历那条
// print-page + printsess + convert/url 的 React 渲染链。
//
// renderer 没配（NoopClient → ErrNotConfigured）时回 503 + 人话错误，
// 不漏栈。

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

// ReportPDFRenderer —— 把完整 HTML doc 渲成 PDF bytes 的窄口子
// (gotenberg.Client / NoopClient 都满足)。在 public 包定义避免 routes →
// gotenberg 的 arch 依赖；wireup 注入具体实现。
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

// renderReportPDF —— member-scoped fetch (#170) + gotenberg HTML→PDF。错误 (not-found /
// not-configured / render) 原样上抛，由 handleReportPDFErr 分流。
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
