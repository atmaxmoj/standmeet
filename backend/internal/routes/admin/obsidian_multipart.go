// obsidian_multipart.go — reads a vault-upload multipart request into VaultFile
// **streaming**.
//
// Split out from obsidian.go: that file orchestrates two endpoints (who calls whom, how
// errors return), this one is an independent concern — how to read a request that may
// carry thousands of parts without materializing the whole thing. The two have different
// reasons to change.

package admin

import (
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/obsidian"
)

// parseImportMultipart reads parts **streaming**, without ParseMultipartForm.
//
// Why ParseMultipartForm can't be used: it buffers the entire form first, and Go's
// mime/multipart.ReadForm has a **hard cap of 1000** parts per form — go over it and the
// whole request fails with "message too large". We never declared that number, and can't
// tune it — while maxObsidianImportSize is a **byte** limit (200MB), which has nothing to
// do with it. The result: a real vault with 574 wiki + 435 raw notes (1033 files after
// client-side filtering) couldn't be imported, even though the payload was only 6.2MB —
// under 4% of the declared quota. Measured boundary: 999 parts succeed, 1001 parts get a
// 400 (F-L-20).
//
// Switching to NextPart() to read one at a time translates "how does a self-hosted git
// service swallow a repository": a forge receiving a packfile treats it as **one stream,
// processed as it's read** — no matter how many objects it holds, it never touches any
// part-count limit, because it never splits the request into N buffered pieces. Same idea
// here: one part at a time, converted to a VaultFile as soon as it's read, no whole-form
// materialization, and therefore no cap on the number of parts. The byte count is still
// bounded by MaxBytesReader — that's the limit we actually **declared**.
func parseImportMultipart(
	w http.ResponseWriter, r *http.Request,
) ([]obsidian.VaultFile, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxObsidianImportSize)
	mr, merr := r.MultipartReader()
	if merr != nil {
		return nil, fmt.Errorf("parse multipart: %w", merr)
	}
	return streamVaultFiles(mr, r)
}

// streamVaultFiles reads the whole request one part at a time, discarding each as it's
// consumed, never holding the whole form.
func streamVaultFiles(mr *multipart.Reader, r *http.Request) ([]obsidian.VaultFile, error) {
	acc := &vaultParts{files: make([]obsidian.VaultFile, 0), form: url.Values{}}
	for {
		p, err := mr.NextPart()
		if err != nil {
			return acc.done(err, r)
		}
		acc.take(p)
	}
}

// vaultParts is the accumulator for the streaming read. A read error is recorded first
// and reported once the stream finishes: returning midway would leave the remaining parts
// sitting on the connection, and the client would see a broken write.
type vaultParts struct {
	err   error
	form  url.Values
	files []obsidian.VaultFile
}

func (a *vaultParts) take(p *multipart.Part) {
	defer closeBestEffort(p)
	body, rerr := io.ReadAll(p)
	if rerr != nil {
		a.err = fmt.Errorf("read vault file %q: %w", p.FormName(), rerr)
		return
	}
	a.put(p.FormName(), p.FileName(), body)
}

// put — a part with a filename is a vault file; everything else is a plain form value
// (that's the path authoritative takes). The field name carries the full rel path;
// stripping a possible vault-name prefix makes the path start from the vault root (the
// genre prefix is kept).
func (a *vaultParts) put(name, filename string, body []byte) {
	if filename == "" {
		a.form.Set(name, string(body))
		return
	}
	a.files = append(a.files, obsidian.VaultFile{
		RelPath: normalizeVaultRel(name), Body: body,
	})
}

// done — the stream is finished. Non-file parts are written back into r.Form: once
// MultipartReader has been used, r.FormValue no longer parses on its own, and without
// this write-back the authoritative flag would silently vanish, degrading a "whole vault"
// sync into an add-only one.
func (a *vaultParts) done(err error, r *http.Request) ([]obsidian.VaultFile, error) {
	r.Form = a.form
	if a.err != nil {
		return nil, a.err
	}
	if !errors.Is(err, io.EOF) {
		return nil, fmt.Errorf("parse multipart: %w", err)
	}
	return a.files, nil
}

func closeBestEffort(c io.Closer) {
	if err := c.Close(); err != nil {
		_ = err
	}
}

// normalizeVaultRel strips webkitRelativePath's first segment when it's the vault folder
// name (not a genre), so the path starts from the vault root (owner picks my-vault/,
// filename = "my-vault/wiki/x.md" → "wiki/x.md"). When the first segment is already a
// genre itself (wiki/…, e.g. a direct upload or a test), it's left as-is — otherwise the
// genre would get mistakenly stripped as the vault name.
func normalizeVaultRel(name string) string {
	parts := strings.SplitN(name, "/", 2)
	if len(parts) == 2 && stripsVaultPrefix(parts[0]) {
		return parts[1]
	}
	return name
}

// stripsVaultPrefix — the first segment is a vault folder name to strip: neither a genre
// nor a dotdir (.obsidian config must be kept).
func stripsVaultPrefix(seg string) bool {
	return !obsidian.IsVaultTopFolder(seg) && !strings.HasPrefix(seg, ".")
}
