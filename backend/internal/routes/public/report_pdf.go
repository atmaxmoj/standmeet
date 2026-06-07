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
	"html"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/atmaxmoj/standmeet/internal/apierr"
	"github.com/atmaxmoj/standmeet/internal/domain"
	"github.com/atmaxmoj/standmeet/internal/gotenberg"
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
	pdf, err := renderReportPDF(h, r, av.Data.OwnerID)
	if err != nil {
		handleReportPDFErr(h, w, err)
		return
	}
	writeReportPDF(h, w, chi.URLParam(r, "id"), pdf)
}

// renderReportPDF —— owner-scoped fetch + gotenberg HTML→PDF。错误 (not-found /
// not-configured / render) 原样上抛，由 handleReportPDFErr 分流。
func renderReportPDF(h *Handlers, r *http.Request, ownerID string) ([]byte, error) {
	report, ferr := fetchOwnedReport(h, r, chi.URLParam(r, "id"), ownerID)
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
	if errors.Is(err, domain.ErrReportNotFound) {
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

// wrapReportHTML —— body fragment → 完整可打印 doc。report.HTML 是 owner AI
// 生成的受限 HTML（summarize prompt 禁 script/style/iframe），这里只包壳 +
// 朴素样式；title 走 html.EscapeString 防注入。
func wrapReportHTML(report *domain.ChatReport) string {
	return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
		"<title>" + html.EscapeString("Report "+report.ID) + "</title><style>" + reportPrintCSS +
		"</style></head><body>" + report.HTML + "</body></html>"
}

const reportPrintCSS = "body{font-family:Georgia,'Times New Roman',serif;color:#1b1814;" +
	"line-height:1.55;font-size:12pt;max-width:46em;margin:0 auto;}" +
	"h1{font-size:20pt;border-bottom:2px solid #b5391c;padding-bottom:.2em;}" +
	"h2{font-size:14pt;color:#b5391c;margin-top:1.2em;}" +
	"ul{padding-left:1.2em;}li{margin:.25em 0;}" +
	"a{color:#b5391c;}" +
	"blockquote{border-left:3px solid #ddd;margin-left:0;padding-left:1em;color:#555;}" +
	"table{border-collapse:collapse;}td,th{border:1px solid #ccc;padding:.3em .6em;}"
