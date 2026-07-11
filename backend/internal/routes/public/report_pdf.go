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
	"github.com/atmaxmoj/standmeet/internal/usecases"
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
	// report.HTML is model output. It is sanitized at generation, but re-sanitize here (defense in
	// depth + covers any pre-fix stored report) since this doc goes to network-enabled Gotenberg.
	return "<!DOCTYPE html><html><head><meta charset=\"utf-8\">" +
		"<title>" + html.EscapeString("Report "+report.ID) + "</title><style>" + reportPrintCSS +
		"</style></head><body>" + usecases.SanitizeReportHTML(report.HTML) + "</body></html>"
}

// reportPrintCSS —— mirrors the on-screen report styling (app's report-document.ts):
// Newsreader serif body, JetBrains Mono uppercase section kickers, ink + vermillion
// on warm paper, so the downloaded PDF matches the brand instead of raw Times.
const reportPrintCSS = "@import url('https://fonts.googleapis.com/css2?" +
	"family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&" +
	"family=JetBrains+Mono:wght@400;500&display=swap');" +
	"body{font-family:'Newsreader',Georgia,serif;color:#1b1814;background:#f3efe6;" +
	"line-height:1.6;font-size:12pt;max-width:46em;margin:0 auto;padding:1.5em 0;}" +
	"h1{font-family:'Newsreader',Georgia,serif;font-size:21pt;font-weight:500;" +
	"letter-spacing:-0.01em;line-height:1.2;margin:0 0 .3em;}" +
	"h2{font-family:'JetBrains Mono',monospace;font-size:10.5pt;font-weight:500;" +
	"text-transform:uppercase;letter-spacing:0.16em;color:#b5391c;margin:1.6em 0 .7em;" +
	"padding-top:.6em;border-top:1px solid #dad3c4;}" +
	"p{margin:0 0 .9em;}ul{padding-left:1.2em;}li{margin:.3em 0;}" +
	"strong{font-weight:600;}a{color:#b5391c;}" +
	"blockquote{border-left:2px solid #b5391c;margin-left:0;padding-left:1em;color:#6b6256;" +
	"font-style:italic;}" +
	"table{border-collapse:collapse;width:100%;}" +
	"td,th{border:1px solid #dad3c4;padding:.3em .6em;}" +
	"th{font-family:'JetBrains Mono',monospace;font-size:9pt;" +
	"text-transform:uppercase;color:#6b6256;}" +
	// report component kit — mirror app/src/lib/page/report-document.ts.
	".lede{font-size:13.5pt;line-height:1.5;margin:0 0 1.2em;}" +
	".callout{border-left:2px solid #b5391c;background:rgba(181,57,28,.05);" +
	"padding:.7em 1em;margin:1.1em 0;}.callout :last-child{margin-bottom:0;}" +
	"ul.checks{list-style:none;padding-left:0;}ul.checks li{position:relative;" +
	"padding-left:1.4em;margin:.4em 0;}ul.checks li:before{content:'\\2192';position:absolute;" +
	"left:0;color:#b5391c;font-family:'JetBrains Mono',monospace;}" +
	".tags{margin:.3em 0 1.2em;}.tag{font-family:'JetBrains Mono',monospace;font-size:9pt;" +
	"text-transform:uppercase;letter-spacing:0.1em;color:#6b6256;border:1px solid #dad3c4;" +
	"padding:.15em .5em;margin-right:.3em;}" +
	".kv{display:flex;gap:1em;padding:.35em 0;border-bottom:1px solid #dad3c4;}" +
	".kv .k{font-family:'JetBrains Mono',monospace;font-size:9.5pt;text-transform:uppercase;" +
	"letter-spacing:0.1em;color:#6b6256;min-width:9em;}.kv .v{flex:1;}" +
	// STAR block — strong per-experience structure, mirror report-document.ts.
	".exp{margin:.4em 0 1.6em;}.star{margin:.5em 0 0;}" +
	".star-row{display:grid;grid-template-columns:7em 1fr;gap:1em;align-items:start;" +
	"padding:.5em 0;border-bottom:1px solid #dad3c4;}" +
	".star-row:first-child{border-top:1px solid #dad3c4;}" +
	".star-k{font-family:'JetBrains Mono',monospace;font-size:9pt;text-transform:uppercase;" +
	"letter-spacing:0.12em;color:#b5391c;padding-top:.2em;}.star-v{margin:0;}"
