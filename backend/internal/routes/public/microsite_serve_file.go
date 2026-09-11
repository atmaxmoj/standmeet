// microsite_serve_file.go —— the file-serving mechanics behind a microsite/homepage request:
// open a built asset off disk, pick its content type, and (for the entry HTML) inject the
// `<base>` + SEO/byoai <head> tags. Pure transport — it touches no domain facade. Split out of
// microsites.go to keep that file under the max-lines cap.

package public

import (
	"errors"
	"html"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// pageHead —— what gets injected into <head> when serving index.html. Empty base =
// this isn't the root entry point this time (a sub-resource request), nothing gets
// injected.
type pageHead struct {
	seoTitle       *string
	seoDescription *string
	seoImage       *string
	base           string
	allowBYOAI     bool
}

// tags —— the lines injected into <head>.
//
// The byoai line is **read fresh on every request**: if the owner flips off "bring
// your own key" on the panel, the next time this page opens it's the new value — no
// snapshot stored in the page, and no need for one more endpoint to ask. This is the
// other half of the same thing as sending no cache header (something taken down must
// stop taking effect immediately).
func (p pageHead) tags() string {
	return `<base href="` + html.EscapeString(p.base) + `">` +
		seoHead(p.seoTitle, p.seoDescription, p.seoImage) +
		`<meta name="standmeet-page-byoai" content="` + strconv.FormatBool(p.allowBYOAI) + `">`
}

func serveFile(log *slog.Logger, w http.ResponseWriter, fp string, head pageHead) {
	f, openErr := os.Open(filepath.Clean(fp))
	if openErr != nil {
		respondOpenErr(log, w, fp, openErr)
		return
	}
	defer closeAndLog(log, f)
	w.Header().Set("Content-Type", contentTypeFor(fp))
	if shouldInjectBase(fp, head.base) {
		writeHTMLWithBase(log, w, f, head)
		return
	}
	streamFile(log, w, f)
}

func shouldInjectBase(fp, baseHref string) bool {
	return baseHref != "" && strings.EqualFold(filepath.Ext(fp), ".html")
}

func streamFile(log *slog.Logger, w io.Writer, f io.Reader) {
	if _, err := io.Copy(w, f); err != nil {
		log.Warn("write asset", logErr, err)
	}
}

// writeHTMLWithBase —— streams index.html, and once it hits `<head>` inserts
// `<base href>`, so vite's ./assets/... always resolves against /p/<slug>/ as its base
// (a single-owner instance, so the URL carries no handle — F-L-44).
func writeHTMLWithBase(log *slog.Logger, w http.ResponseWriter, f io.Reader, head pageHead) {
	body, err := io.ReadAll(f)
	if err != nil {
		log.Error("read html", logErr, err)
		return
	}
	out := injectHead(string(body), head)
	if _, werr := io.WriteString(w, out); werr != nil {
		log.Warn("write html with base", logErr, werr)
	}
}

// injectHead —— injects <base> and this page's settings into <head>.
// html.EscapeString escapes any " < > & inside baseHref, preventing an attacker from
// using a malformed URL (e.g. a handle containing a quote) to inject extra attributes
// → XSS.
func injectHead(htmlBody string, head pageHead) string {
	tag := head.tags()
	if i := strings.Index(htmlBody, "<head>"); i >= 0 {
		return htmlBody[:i+len("<head>")] + tag + htmlBody[i+len("<head>"):]
	}
	return tag + htmlBody
}

func respondOpenErr(log *slog.Logger, w http.ResponseWriter, fp string, err error) {
	if errors.Is(err, os.ErrNotExist) {
		http.Error(w, "asset not found", http.StatusNotFound)
		return
	}
	log.Error("open asset", "path", fp, logErr, err)
	http.Error(w, "asset error", http.StatusInternalServerError)
}

func closeAndLog(log *slog.Logger, f *os.File) {
	if err := f.Close(); err != nil {
		log.Warn("close asset", logErr, err)
	}
}

// contentTypeByExt —— a top-level map so contentTypeFor is a table lookup, keeping
// cyclo at 1.
var contentTypeByExt = map[string]string{
	".html": "text/html; charset=utf-8",
	".js":   "application/javascript; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg":  "image/svg+xml",
}

func contentTypeFor(fp string) string {
	ext := strings.ToLower(filepath.Ext(fp))
	if ct, ok := contentTypeByExt[ext]; ok {
		return ct
	}
	return "application/octet-stream"
}
