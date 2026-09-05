// media_guard.go —— fetches a piece of media from an owner-given URL, plus every guard
// applied at fetch time.
//
// The URL is **handed in by the owner**; the server requests it and serves the bytes back
// from our own domain — an SSRF opening on the way in, a stored-content risk on the way out.
//
// Outbound: https only. BlockInternalEgress, since a public-looking domain can still
// resolve or redirect to an internal address.
//
// Inbound:
//   - **Allowlist, not prefix match.** `image/*` would admit image/svg+xml, whose <script>
//     becomes stored XSS once served back from our domain.
//   - **Never trust the declared type.** Content-Type is a claim; verification goes by
//     **byte signature**, or a declared-PNG SVG executes under the SVG's identity.
//   - **Limit checked against bytes actually read**, never Content-Length — the basic bypass.
//   - **Limit split by kind**: video is inherently larger than an image.

package usecase

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

const mediaFetchTimeout = 15 * time.Second

// mediaFetchUA —— identifies us when fetching media. **Not decoration**: sites like
// Wikimedia require a descriptive UA and 403 an HTTP library's default value.
const mediaFetchUA = "StandMeet/0.1 (self-hosted; +https://github.com/atmaxmoj/standmeet)"

// Size limit by kind. A video is inherently larger than an image — capping both to the
// same number effectively bans video.
const (
	maxImageBytes      = 10 << 20 // illustrations / hero images
	maxAttachmentBytes = 25 << 20 // attachments (PDF etc.)
	maxVideoBytes      = 50 << 20 // video (a short clip in the body / a demo recording)
)

// mediaKinds —— which types each use accepts. **An explicit allowlist** (a prefix match
// would admit image/svg+xml). svg is never in the table: it's an executable document.
var mediaKinds = map[string]map[string]int64{
	entity.AssetKindImage: {
		"image/png":  maxImageBytes,
		"image/jpeg": maxImageBytes,
		"image/gif":  maxImageBytes,
		"image/webp": maxImageBytes,
		"image/avif": maxImageBytes,
		// a short video in the body is the same thing as an animated image.
		"video/mp4":  maxVideoBytes,
		"video/webm": maxVideoBytes,
	},
	entity.AssetKindAttachment: {
		"application/pdf": maxAttachmentBytes,
		"text/plain":      maxAttachmentBytes,
		"text/markdown":   maxAttachmentBytes,
		"text/csv":        maxAttachmentBytes,
		"application/zip": maxAttachmentBytes,
		"video/mp4":       maxVideoBytes,
		"image/png":       maxImageBytes,
		"image/jpeg":      maxImageBytes,
	},
}

// FetchedMedia —— one fetched piece of media.
type FetchedMedia struct {
	ContentType string
	Filename    string
	Body        []byte
}

// FetchMediaInput —— what's needed to fetch one piece of media.
type FetchMediaInput struct {
	URL      string
	Kind     string
	Filename string
}

// FetchMedia —— fetches a piece of media by URL, through every guard.
func FetchMedia(ctx context.Context, in *FetchMediaInput) (FetchedMedia, error) {
	allowed, kerr := allowedTypes(in.Kind)
	if kerr != nil {
		return FetchedMedia{}, kerr
	}
	if verr := httpsOnly(in.URL); verr != nil {
		return FetchedMedia{}, verr
	}
	resp, ferr := getOverHTTP(ctx, in.URL)
	if ferr != nil {
		return FetchedMedia{}, ferr
	}
	defer closeBestEffort(resp.Body)
	return readGuarded(resp, in, allowed)
}

// AcceptMediaInput —— a file the owner picked from their own machine. **No URL**, the
// bytes are already in hand.
type AcceptMediaInput struct {
	Filename   string
	Kind       string
	DeclaredCT string
	Body       []byte
}

// AcceptMedia —— accepts bytes handed in directly, through the **inbound** half of the
// guard. No outbound half: there's no URL, so no SSRF opening — but inbound checks still
// apply, since the served-back file is still stored XSS if it's SVG declared as PNG.
//
// Converges with FetchMedia on the same checks (allowlist / limit / byte match) so neither
// path can drift unguarded.
func AcceptMedia(in *AcceptMediaInput) (FetchedMedia, error) {
	allowed, kerr := allowedTypes(in.Kind)
	if kerr != nil {
		return FetchedMedia{}, kerr
	}
	declared := baseType(in.DeclaredCT)
	limit, ok := allowed[declared]
	if !ok {
		return FetchedMedia{}, fmt.Errorf("%w: content-type %s is not accepted for %s",
			entity.ErrMediaRejected, declared, kindOrImage(in.Kind))
	}
	// Limit checked against bytes actually in hand — no more evidence than a remote Content-Length.
	if int64(len(in.Body)) > limit {
		return FetchedMedia{}, fmt.Errorf(
			"%w: body exceeds the %d byte limit", entity.ErrMediaRejected, limit,
		)
	}
	if serr := bytesAgree(in.Body, declared); serr != nil {
		return FetchedMedia{}, serr
	}
	return FetchedMedia{Body: in.Body, ContentType: declared, Filename: in.Filename}, nil
}

func allowedTypes(kind string) (map[string]int64, error) {
	if kind == "" {
		kind = entity.AssetKindImage
	}
	allowed, ok := mediaKinds[kind]
	if !ok {
		return nil, fmt.Errorf("%w: kind %q", entity.ErrMediaRejected, kind)
	}
	return allowed, nil
}

func httpsOnly(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("%w: parse url: %s", entity.ErrMediaRejected, err.Error())
	}
	if u.Scheme != "https" {
		return fmt.Errorf("%w: only https URLs allowed, got %q", entity.ErrMediaRejected, u.Scheme)
	}
	return nil
}

func getOverHTTP(ctx context.Context, rawURL string) (*http.Response, error) {
	// BlockInternalEgress —— owner-given URL, no allowlist: must not reach the internal
	// network (metadata endpoints etc). https alone isn't enough — a public-looking domain
	// can still resolve or redirect internally.
	client := httpx.NewClient(httpx.Options{
		Timeout: mediaFetchTimeout, BlockInternalEgress: true,
	})
	req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, http.NoBody)
	if rerr != nil {
		return nil, fmt.Errorf("%w: build request: %s", entity.ErrMediaRejected, rerr.Error())
	}
	// Without a UA, Go sends `Go-http-client/2.0` and hosts requiring a descriptive UA
	// (Wikimedia notably) 403 it — the owner's most common source failing with a bare
	// `status 403` (F-P-7).
	req.Header.Set("User-Agent", mediaFetchUA)
	resp, herr := client.Do(req)
	if herr != nil {
		return nil, fmt.Errorf("%w: fetch: %s", entity.ErrMediaRejected, herr.Error())
	}
	if resp.StatusCode != http.StatusOK {
		closeBestEffort(resp.Body)
		return nil, fmt.Errorf("%w: status %d", entity.ErrMediaRejected, resp.StatusCode)
	}
	return resp, nil
}

// readGuarded —— reads the body back + three guards: the declared type is on the
// allowlist, the actual bytes match the declaration, and it's under the size limit.
func readGuarded(
	resp *http.Response, in *FetchMediaInput, allowed map[string]int64,
) (FetchedMedia, error) {
	declared := baseType(resp.Header.Get("Content-Type"))
	limit, ok := allowed[declared]
	if !ok {
		return FetchedMedia{}, fmt.Errorf("%w: content-type %s is not accepted for %s",
			entity.ErrMediaRejected, declared, in.Kind)
	}
	body, rerr := readAtMost(resp.Body, limit)
	if rerr != nil {
		return FetchedMedia{}, rerr
	}
	if serr := bytesAgree(body, declared); serr != nil {
		return FetchedMedia{}, serr
	}
	return FetchedMedia{
		Body: body, ContentType: declared,
		Filename: pickFilename(in.Filename, resp.Request.URL.Path),
	}, nil
}

// readAtMost —— checks the limit against bytes actually read, not Content-Length (the
// basic bypass). Reading one byte past the limit is enough to know it's over.
func readAtMost(r io.Reader, limit int64) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, fmt.Errorf("%w: read body: %s", entity.ErrMediaRejected, err.Error())
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("%w: body exceeds the %d byte limit", entity.ErrMediaRejected, limit)
	}
	return body, nil
}

// bytesAgree —— whether the actual bytes match the declared type; the declaration is a
// claim, not evidence.
//
// Checked by **byte signature**, not http.DetectContentType, which misses webp/mp4/avif
// and has no SVG signature — so a declared-PNG SVG reads as text/plain and passes through,
// then executes under the SVG's identity once served back.
//
// Types with no known signature (the plain-text ones) fall back to "at least not an
// executable document".
func bytesAgree(body []byte, declared string) error {
	sigs, known := mediaMagic[declared]
	if !known {
		return notExecutableDoc(body, declared)
	}
	for _, sig := range sigs {
		if sig.matches(body) {
			return nil
		}
	}
	return fmt.Errorf(
		"%w: declared %s but the bytes are not %s — content mismatch",
		entity.ErrMediaRejected, declared, declared,
	)
}

// notExecutableDoc —— for plain-text types with no byte signature, blocks at least an
// executable document (e.g. declared text/plain, actually HTML) from becoming stored XSS.
func notExecutableDoc(body []byte, declared string) error {
	sniffed := baseType(http.DetectContentType(body))
	if !executableDoc(sniffed) {
		return nil
	}
	return fmt.Errorf(
		"%w: declared %s but the bytes are %s — a document that can execute is not media",
		entity.ErrMediaRejected, declared, sniffed,
	)
}

// magic —— one byte signature: at offset, the bytes should be want.
type magic struct {
	want   []byte
	offset int
}

func (m magic) matches(body []byte) bool {
	end := m.offset + len(m.want)
	return len(body) >= end && bytes.Equal(body[m.offset:end], m.want)
}

// mediaMagic —— types with a known signature. Any one entry matching is enough (gif has
// two version numbers, avif is also in the ftyp family).
var mediaMagic = map[string][]magic{
	"image/png":       {{want: []byte("\x89PNG\r\n\x1a\n")}},
	"image/jpeg":      {{want: []byte("\xff\xd8\xff")}},
	"image/gif":       {{want: []byte("GIF87a")}, {want: []byte("GIF89a")}},
	"image/webp":      {{want: []byte("RIFF")}},
	"image/avif":      {{offset: 4, want: []byte("ftyp")}},
	"video/mp4":       {{offset: 4, want: []byte("ftyp")}},
	"video/webm":      {{want: []byte("\x1a\x45\xdf\xa3")}},
	"application/pdf": {{want: []byte("%PDF")}},
	"application/zip": {{want: []byte("PK\x03\x04")}},
}

// executableDoc —— types the browser will execute as a document. Both SVG and HTML can
// carry scripts.
func executableDoc(t string) bool {
	switch t {
	case "text/html", "image/svg+xml", "text/xml", "application/xml":
		return true
	default:
		return false
	}
}

func baseType(ct string) string {
	if i := strings.Index(ct, ";"); i >= 0 {
		ct = ct[:i]
	}
	return strings.ToLower(strings.TrimSpace(ct))
}

func pickFilename(given, urlPath string) string {
	if given != "" {
		return given
	}
	if i := strings.LastIndex(urlPath, "/"); i >= 0 {
		return urlPath[i+1:]
	}
	return urlPath
}

func closeBestEffort(c io.Closer) {
	if err := c.Close(); err != nil {
		_ = err
	}
}

// MediaRejected —— whether this error means "this piece of media is rejected" (a problem
// with the caller's input, not a fault on our end).
func MediaRejected(err error) bool { return errors.Is(err, entity.ErrMediaRejected) }
