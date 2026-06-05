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
// options (US Letter, no margins, wait until `networkidle`).
//
// PDF永远 ephemeral —— the bytes flow straight back through MCP to
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
)

// ErrNotConfigured —— surfaced by NoopClient when commit is invoked
// before a real Gotenberg endpoint is wired. Lets the wireup ship the
// rip-out commit even while task 11 is still on the bench.
var ErrNotConfigured = errors.New("gotenberg renderer not configured")

// Renderer —— matches jobsuc.PDFRenderer (J.2 起 PDFRenderer 接口随
// applications usecase 搬到 plugins/jobs/jobsuc/)。Defined here too so the
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
		http:     &http.Client{Timeout: gotenbergTimeout},
	}
}

const (
	gotenbergTimeout = 60 * time.Second
	paperWidthIn     = "8.5"
	paperHeightIn    = "11"
	// printScale —— Chromium默认 1 CSS px = 0.75 PDF pt (96dpi → 72dpi).
	// Our ResumePage uses px so values match the design admin.js literal
	// (612 px page width = the PDF point grid). scale=1.333 makes the
	// viewport 612 CSS px wide instead of 816, so the 612px element fills
	// the US Letter paper exactly and font px === PDF pt.
	printScale = "1.3333333"
)

// RenderURL —— POST a multipart form to /forms/chromium/convert/url with
// the page URL + US Letter paper + wait-until-networkidle. Returns raw
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
		"url":          printURL,
		"paperWidth":   paperWidthIn,
		"paperHeight":  paperHeightIn,
		"marginTop":    "0",
		"marginBottom": "0",
		"marginLeft":   "0",
		"marginRight":  "0",
		"scale":        printScale,
		"waitDelay":    "300ms",
	}
	for k, v := range fields {
		if err := mp.WriteField(k, v); err != nil {
			return nil, fmt.Errorf("multipart write %s: %w", k, err)
		}
	}
	if err := mp.Close(); err != nil {
		return nil, fmt.Errorf("multipart close: %w", err)
	}
	return &encodedForm{body: body, contentType: mp.FormDataContentType()}, nil
}

// NoopClient —— Returns ErrNotConfigured on every call. Wired in
// `wireup.go` until the real Gotenberg endpoint env var lands.
type NoopClient struct{}

// RenderURL implements Renderer.
func (NoopClient) RenderURL(_ context.Context, _ string) ([]byte, error) {
	return nil, ErrNotConfigured
}
