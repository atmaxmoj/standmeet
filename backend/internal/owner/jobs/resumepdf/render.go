// Package resumepdf renders a resume PDF from structured ResumeContent via Typst.
//
// Why Typst (not the old React→gotenberg path): it gives typographic quality (LaTeX-grade),
// data-driven templates, and an owner-customizable presentation — all over one structured content
// model. The content is placed as *content*, never eval'd, so a résumé field can't inject Typst
// code (like SQL-parameter binding). The QR is generated server-side here, so the owner's data can
// never change what it encodes.
//
// Customization = which template. Templates live in templates/*.typ; each renders the same
// ResumeContent, so the choice changes presentation, never content. The owner picks a template;
// the content is always supplied (by MCP or the composer) the same way.
package resumepdf

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	qrcode "github.com/skip2/go-qrcode"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
)

//go:embed templates/*.typ
var templatesFS embed.FS

// DefaultTemplate —— used when RenderOptions.Template is empty.
const DefaultTemplate = "classic"

const (
	stageFilePerm = 0o600 // temp render inputs: owner-only
	qrPixelSize   = 256   // QR PNG side, plenty for print
)

// ErrUnknownTemplate —— the requested template name has no templates/<name>.typ.
var ErrUnknownTemplate = errors.New("unknown resume template")

// RenderOptions —— presentation choices for one render. Template selects the layout;
// Role/Company are the job the resume targets; QRURL is the per-application URL the QR encodes.
type RenderOptions struct {
	Template string
	Role     string
	Company  string
	QRURL    string
}

// Renderer shells out to the Typst binary. bin defaults to "typst"; fontPath (optional) points at
// the Newsreader + JetBrains Mono files so the print matches the web.
type Renderer struct {
	bin      string
	fontPath string
}

// New builds a Renderer. Empty bin → "typst" on PATH; empty fontPath → Typst's default fonts.
func New(bin, fontPath string) Renderer {
	if bin == "" {
		bin = "typst"
	}
	return Renderer{bin: bin, fontPath: fontPath}
}

// Templates —— the layout names an owner may choose from.
func Templates() []string {
	entries, err := templatesFS.ReadDir("templates")
	if err != nil {
		return []string{}
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Name()[:len(e.Name())-len(".typ")])
	}
	return out
}

// Render lays out one resume under the chosen template.
func (r Renderer) Render(
	ctx context.Context, content *jobsmodel.ResumeContent, opts RenderOptions,
) ([]byte, error) {
	tmpl, terr := loadTemplate(opts.Template)
	if terr != nil {
		return nil, terr
	}
	dir, err := os.MkdirTemp("", "resume-*")
	if err != nil {
		return nil, fmt.Errorf("resume tmpdir: %w", err)
	}
	defer os.RemoveAll(dir) //nolint:errcheck // best-effort temp cleanup, nothing actionable
	if werr := stage(dir, tmpl, content, opts.QRURL); werr != nil {
		return nil, werr
	}
	return r.compile(ctx, dir, opts)
}

// loadTemplate —— fetch templates/<name>.typ; empty → default; unknown → ErrUnknownTemplate.
func loadTemplate(name string) ([]byte, error) {
	if name == "" {
		name = DefaultTemplate
	}
	b, err := templatesFS.ReadFile("templates/" + name + ".typ")
	if err != nil {
		return nil, fmt.Errorf("%w: %q", ErrUnknownTemplate, name)
	}
	return b, nil
}

// stage writes the template (main.typ), the content JSON, and (when there's a URL) the QR image.
func stage(dir string, tmpl []byte, content *jobsmodel.ResumeContent, qrURL string) error {
	if werr := os.WriteFile(filepath.Join(dir, "main.typ"), tmpl, stageFilePerm); werr != nil {
		return fmt.Errorf("write template: %w", werr)
	}
	data, merr := json.Marshal(content)
	if merr != nil {
		return fmt.Errorf("marshal resume content: %w", merr)
	}
	if werr := os.WriteFile(filepath.Join(dir, "data.json"), data, stageFilePerm); werr != nil {
		return fmt.Errorf("write data.json: %w", werr)
	}
	return stageQR(dir, qrURL)
}

// stageQR —— server-build the QR image from the per-application URL (empty URL → no QR).
func stageQR(dir, qrURL string) error {
	if qrURL == "" {
		return nil
	}
	png, qerr := qrcode.Encode(qrURL, qrcode.Medium, qrPixelSize)
	if qerr != nil {
		return fmt.Errorf("encode qr: %w", qerr)
	}
	if werr := os.WriteFile(filepath.Join(dir, "qr.png"), png, stageFilePerm); werr != nil {
		return fmt.Errorf("write qr.png: %w", werr)
	}
	return nil
}

// compile runs `typst compile` in the staged dir and returns the PDF bytes.
func (r Renderer) compile(
	ctx context.Context, dir string, opts RenderOptions,
) ([]byte, error) {
	out := filepath.Join(dir, "out.pdf")
	args := []string{
		"compile",
		"--input", "qr=" + opts.QRURL,
		"--input", "role=" + opts.Role,
		"--input", "company=" + opts.Company,
	}
	if r.fontPath != "" {
		args = append(args, "--font-path", r.fontPath)
	}
	args = append(args, filepath.Join(dir, "main.typ"), out)
	// r.bin is our configured typst path; args are fixed flags + values passed as typst `--input`
	// (no shell), and résumé content is a file the template reads, never argv.
	cmd := exec.CommandContext(ctx, r.bin, args...) // #nosec G204
	cmd.Dir = dir
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if rerr := cmd.Run(); rerr != nil {
		return nil, fmt.Errorf("typst compile: %w: %s", rerr, stderr.String())
	}
	pdf, rerr := os.ReadFile(out)
	if rerr != nil {
		return nil, fmt.Errorf("read rendered pdf: %w", rerr)
	}
	return pdf, nil
}
