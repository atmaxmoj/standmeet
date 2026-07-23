// report_document.go —— the ONE authoritative styling for a summarize report.
//
// The report is a self-contained artifact: generateReportHTML wraps the sanitized model body with
// this stylesheet at creation, so every surface renders the identical document — the inline chat
// card (a windowed iframe onto it), the /report/<id> page, and the gotenberg PDF. Before this,
// three code paths styled the same body three different ways (card: none → browser-default Times;
// page: one CSS; PDF: another), so the "preview" never matched "open as page". One truth fixes it.
//
// Design language = the product's paper aesthetic (docs/design): warm cream paper, ink + accent,
// Newsreader serif body, JetBrains Mono uppercase kickers — subtraction over decoration. The model
// composes ONLY the component-kit classes (lede / callout / checks / tags / STAR); it never authors
// CSS (the prompt forbids <style>/<script>, and SanitizeReportHTML strips them), so this trusted
// wrapper is the sole styling.

package usecases

import "strings"

// fontImport —— webfonts for the report. Kept as its own long line via concatenation (line-length).
// Fallbacks (Georgia / ui-monospace) carry the look where the font can't load (e.g. the fully
// sandboxed inline-card iframe), so the paper aesthetic holds regardless.
const fontImport = "@import url('https://fonts.googleapis.com/css2?" +
	"family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&" +
	"family=JetBrains+Mono:wght@400;500&display=swap');"

// reportCSS —— the authoritative report stylesheet (mirrors the design language; kept here because
// generation is server-side and the artifact must ship self-contained).
const reportCSS = fontImport + `
:root{--paper:#F3EFE6;--ink:#1B1814;--accent:#B5391C;--muted:#6B6256;--rule:#DAD3C4;}
*{box-sizing:border-box;}
html,body{margin:0;}
body{background:var(--paper);color:var(--ink);font-family:'Newsreader',Georgia,serif;
  font-size:17px;line-height:1.65;padding:56px 40px 80px;max-width:44em;margin:0 auto;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
h1{font-family:'Newsreader',Georgia,serif;font-size:32px;font-weight:500;line-height:1.15;
  letter-spacing:-0.014em;margin:0 0 .15em;text-wrap:balance;}
h1+*{margin-top:1.5em;}
h2{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;font-weight:500;
  text-transform:uppercase;letter-spacing:0.18em;color:var(--accent);
  margin:2.4em 0 1em;padding-top:1em;border-top:1px solid var(--rule);}
h3{font-family:'Newsreader',Georgia,serif;font-size:19px;font-weight:500;margin:1.7em 0 .5em;}
p{margin:0 0 1.05em;}
ul,ol{padding-left:1.15em;margin:0 0 1.05em;}
li{margin:.4em 0;}
strong{font-weight:600;color:var(--ink);}
em{font-style:italic;}
a{color:var(--accent);text-underline-offset:2px;}
blockquote{border-left:2px solid var(--accent);margin:1.3em 0;padding:.2em 0 .2em 1.1em;
  color:var(--muted);font-style:italic;}
table{border-collapse:collapse;width:100%;margin:1.1em 0;font-size:15px;}
th,td{border:1px solid var(--rule);padding:.45em .7em;text-align:left;}
th{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;text-transform:uppercase;
  letter-spacing:0.08em;color:var(--muted);}
/* ── report component kit (the AI composes these; never authors its own CSS) ── */
.lede{font-size:21px;line-height:1.5;color:var(--ink);margin:0 0 1.6em;text-wrap:pretty;}
.callout{border-left:2px solid var(--accent);background:rgba(181,57,28,.05);
  padding:.95em 1.15em;margin:1.4em 0;}
.callout :last-child{margin-bottom:0;}
ul.checks{list-style:none;padding-left:0;margin:0 0 1.05em;}
ul.checks li{position:relative;padding-left:1.5em;margin:.5em 0;}
ul.checks li::before{content:"\2192";position:absolute;left:0;color:var(--accent);
  font-family:'JetBrains Mono',ui-monospace,monospace;}
.tags{display:flex;flex-wrap:wrap;gap:.4em;margin:.4em 0 1.5em;}
.tag{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;text-transform:uppercase;
  letter-spacing:0.1em;color:var(--muted);border:1px solid var(--rule);padding:.2em .6em;}
.kv{display:flex;gap:1em;padding:.4em 0;border-bottom:1px solid var(--rule);}
.kv .k{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:11px;text-transform:uppercase;
  letter-spacing:0.12em;color:var(--muted);min-width:9em;}
.kv .v{flex:1;}
/* STAR block — Situation/Task/Action/Result as a labelled two-column grid, not loose bullets. */
.exp{margin:.4em 0 2em;}
.star{margin:.6em 0 0;}
.star-row{display:grid;grid-template-columns:7.5em 1fr;gap:1.2em;align-items:start;
  padding:.7em 0;border-bottom:1px solid var(--rule);}
.star-row:first-child{border-top:1px solid var(--rule);}
.star-k{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;font-weight:500;
  text-transform:uppercase;letter-spacing:0.14em;color:var(--accent);padding-top:.25em;}
.star-v{margin:0;}
/* print (PDF via gotenberg): tighten the outer frame, keep the paper look. */
@page{margin:1.4cm;}
@media print{body{padding:0;max-width:none;background:#fff;}h2{break-after:avoid;}
  .exp,.callout,.star-row{break-inside:avoid;}}
`

// ReportStyledDocument —— body fragment → a complete self-contained styled HTML document.
// Idempotent: a fragment that is already a full document is returned unchanged (no double-wrap).
func ReportStyledDocument(fragment string) string {
	if IsFullReportDocument(fragment) {
		return fragment
	}
	return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
		"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
		"<style>" + reportCSS + "</style></head><body>" + fragment + "</body></html>"
}

// IsFullReportDocument —— already a complete doc (doctype or <html> root)? Then it is the self-
// contained styled artifact and must render AS-IS — re-wrapping double-nests it and re-sanitizing
// strips the trusted <style>. A bare fragment (legacy pre-unification report) returns false.
func IsFullReportDocument(s string) bool {
	t := strings.ToLower(strings.TrimSpace(s))
	return strings.HasPrefix(t, "<!doctype") || strings.HasPrefix(t, "<html")
}
