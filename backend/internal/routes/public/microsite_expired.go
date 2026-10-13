// microsite_expired.go —— what an ephemeral page says once its time ran out
// (docs/design/job-loop-retention.md §4): 410, gone on purpose — not a 404, which reads as a
// broken link.

package public

import (
	"log/slog"
	"net/http"
)

const expiredPage = `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
	`<meta name="viewport" content="width=device-width,initial-scale=1">` +
	`<title>Page expired</title>` +
	`</head><body style="font-family:Georgia,serif;background:#F3EFE6;color:#1B1814;` +
	`max-width:36rem;margin:20vh auto;padding:0 1rem"><h1>This page has expired.</h1>` +
	`<p>It was shared for a limited time. Ask the person who sent it for a new link.</p>` +
	`</body></html>`

func writeExpired(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusGone)
	if _, werr := w.Write([]byte(expiredPage)); werr != nil {
		slog.Default().Warn("expired page write", "err", werr)
	}
}
