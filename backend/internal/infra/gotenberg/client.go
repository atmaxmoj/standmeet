// Package gotenberg —— thin client for the Gotenberg HTTP API (headless
// Chromium PDF rendering). StandMeet calls this once per
// applications.commit to convert the React-rendered ResumePage at a
// per-application "print URL" into the PDF bytes the recruiter receives.
//
// Why a sidecar (not in-process Go rendering): the React preview the
// owner sees in /admin and the PDF the recruiter scans must be the same
// pixels. Chromium = Chromium guarantees that; manual gopdf was hand-
// tuned point math and drifted from the React component.
//
// Phase 1 ships only one entry — `Render(ctx, printURL)` → POST to
// `/forms/chromium/convert/url` with `url=<printURL>` + a few fixed page
// options (the page's own @page size, no margins, scale 1, a short wait for fonts).
//
// The PDF is always ephemeral —— the bytes flow straight back through MCP to
// Claude; we do not write them to disk.
package gotenberg

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/httpx"
)

// ErrNotConfigured —— surfaced by NoopClient when commit is invoked
// before a real Gotenberg endpoint is wired. Lets the wireup ship the
// rip-out commit even while task 11 is still on the bench.
var ErrNotConfigured = errors.New("gotenberg renderer not configured")

// Renderer —— matches jobsuc.PDFRenderer (as of J.2, the PDFRenderer interface
// moved with the applications usecase to plugins/jobs/jobsuc/). Defined here too so the
// gotenberg package can be referenced standalone in tests / fakes
// without dragging in the jobsuc package.
type Renderer interface {
	RenderURL(ctx context.Context, printURL string) ([]byte, error)
}

// Client —— concrete renderer pointing at a Gotenberg HTTP endpoint.
//
// Field order: pointer first then string, packs the two GC-scannable
// pointers (http, endpoint.ptr) into the prefix so the runtime stops
// scanning at offset 16 instead of 24 (fieldalignment).
type Client struct {
	http     *http.Client
	endpoint string // e.g. "http://gotenberg:3000"
}

// New —— constructs a Client. The endpoint must be the base URL of the
// Gotenberg service (no trailing slash). Timeout is generous (60s) so a
// cold Chromium spin-up doesn't kill a commit.
func New(endpoint string) *Client {
	return &Client{
		endpoint: endpoint,
		http:     httpx.NewClient(httpx.Options{Timeout: gotenbergTimeout}),
	}
}

const (
	gotenbergTimeout = 60 * time.Second
	paperWidthIn     = "8.5"
	paperHeightIn    = "11"
	// The résumé prints at scale 1 on the paper its own page asks for (@page size, from the
	// owner's letter/A4 setting — preferCssPageSize): a Letter page is 816 CSS px wide and an
	// A4 page 794, the widths of the editor's sheets, so the PDF wraps every line where the
	// canvas does and breaks pages where the canvas shows them (app lib/admin/resume-pages.ts).
	// It used to print on Letter at 1.333× (a 612 px layout from the retired ResumePage), so no
	// canvas could predict its pages.
	resumePrintScale = "1"
)

// RenderURL —— POST a multipart form to /forms/chromium/convert/url with
// the page URL at the page's own paper size. Returns raw
// PDF bytes on 200, error otherwise.
//
// Named returns let the deferred Body.Close surface its error via the
// returned err only when no other error has already happened, which
// keeps errcheck + bodyclose both happy without nolint suppression.
func (c *Client) RenderURL(
	ctx context.Context, printURL string,
) ([]byte, error) {
	req, err := c.buildRequest(ctx, printURL)
	if err != nil {
		return nil, err
	}
	return c.doRender(req)
}

// RenderHTML —— convert a self-contained HTML document to PDF via Gotenberg's
// /forms/chromium/convert/html (an index.html file upload), with document-
// friendly Letter margins. Used for the chat-report download — a simple HTML
// doc that doesn't need the URL/print-page dance RenderURL uses for the
// pixel-perfect résumé. Not on the Renderer interface (which stays RenderURL-
// only for the résumé path); callers that need it take this method directly.
func (c *Client) RenderHTML(ctx context.Context, html string) ([]byte, error) {
	form, err := buildHTMLForm(html)
	if err != nil {
		return nil, err
	}
	url := c.endpoint + "/forms/chromium/convert/html"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, form.body)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", form.contentType)
	return c.doRender(req)
}

// doRender —— POST a prepared Gotenberg request, read the PDF bytes (or the
// error body), and close. Shared by RenderURL + RenderHTML.
func (c *Client) doRender(req *http.Request) ([]byte, error) {
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("post gotenberg: %w", err)
	}
	pdf, readErr := readPDFOrErr(resp)
	if closeErr := resp.Body.Close(); closeErr != nil && readErr == nil {
		return nil, fmt.Errorf("close gotenberg body: %w", closeErr)
	}
	return pdf, readErr
}

const errBodyLimit = 512

func (c *Client) buildRequest(
	ctx context.Context, printURL string,
) (*http.Request, error) {
	form, err := buildURLForm(printURL)
	if err != nil {
		return nil, err
	}
	url := c.endpoint + "/forms/chromium/convert/url"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, form.body)
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", form.contentType)
	return req, nil
}

func readPDFOrErr(resp *http.Response) ([]byte, error) {
	if resp.StatusCode != http.StatusOK {
		return nil, errorFromBody(resp)
	}
	pdf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read gotenberg body: %w", err)
	}
	return pdf, nil
}

func errorFromBody(resp *http.Response) error {
	excerpt, err := io.ReadAll(io.LimitReader(resp.Body, errBodyLimit))
	if err != nil {
		return fmt.Errorf(
			"gotenberg status %d (body unreadable: %w)", resp.StatusCode, err,
		)
	}
	return fmt.Errorf("gotenberg status %d: %s", resp.StatusCode, string(excerpt))
}

// encodedForm —— bundles the multipart body and its computed Content-Type
// so buildURLForm fits the function-result-limit (max 2 returns).
type encodedForm struct {
	body        *bytes.Buffer
	contentType string
}

func buildURLForm(printURL string) (*encodedForm, error) {
	body := &bytes.Buffer{}
	mp := multipart.NewWriter(body)
	fields := map[string]string{
		"url": printURL,
		// Letter unless the page's @page size says otherwise (the owner's paper setting).
		"paperWidth":        paperWidthIn,
		"paperHeight":       paperHeightIn,
		"preferCssPageSize": "true",
		// No page margins here: the paper element pads every page itself (print.css), so the cream
		// ground reaches the sheet's edges.
		"marginTop":    "0",
		"marginBottom": "0",
		"marginLeft":   "0",
		"marginRight":  "0",
		"scale":        resumePrintScale,
		"waitDelay":    "300ms",
	}
	if err := writeFields(mp, fields); err != nil {
		return nil, err
	}
	if err := mp.Close(); err != nil {
		return nil, fmt.Errorf("multipart close: %w", err)
	}
	return &encodedForm{body: body, contentType: mp.FormDataContentType()}, nil
}

func buildHTMLForm(html string) (*encodedForm, error) {
	body := &bytes.Buffer{}
	mp := multipart.NewWriter(body)
	if err := writeIndexHTML(mp, html); err != nil {
		return nil, err
	}
	if err := writeFields(mp, htmlPageFields); err != nil {
		return nil, err
	}
	if err := mp.Close(); err != nil {
		return nil, fmt.Errorf("multipart close: %w", err)
	}
	return &encodedForm{body: body, contentType: mp.FormDataContentType()}, nil
}

// htmlPageFields —— document-friendly Letter margins for the report PDF.
var htmlPageFields = map[string]string{
	"paperWidth":   paperWidthIn,
	"paperHeight":  paperHeightIn,
	"marginTop":    "0.5",
	"marginBottom": "0.5",
	"marginLeft":   "0.6",
	"marginRight":  "0.6",
}

func writeIndexHTML(mp *multipart.Writer, html string) error {
	part, err := mp.CreateFormFile("files", "index.html")
	if err != nil {
		return fmt.Errorf("multipart index.html: %w", err)
	}
	if _, werr := io.WriteString(part, html); werr != nil {
		return fmt.Errorf("multipart write html: %w", werr)
	}
	return nil
}

func writeFields(mp *multipart.Writer, fields map[string]string) error {
	for k, v := range fields {
		if err := mp.WriteField(k, v); err != nil {
			return fmt.Errorf("multipart write %s: %w", k, err)
		}
	}
	return nil
}

// NoopClient —— Returns ErrNotConfigured on every call. Wired in
// `boot_wireup.go` until the real Gotenberg endpoint env var lands.
type NoopClient struct{}

// RenderURL implements Renderer.
func (NoopClient) RenderURL(_ context.Context, _ string) ([]byte, error) {
	return nil, ErrNotConfigured
}

// RenderHTML —— Noop variant; mirrors Client.RenderHTML's signature.
func (NoopClient) RenderHTML(_ context.Context, _ string) ([]byte, error) {
	return nil, ErrNotConfigured
}
