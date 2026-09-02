package resumepdf_test

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"

	"github.com/ledongthuc/pdf"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/resumepdf"
)

// requireTypst —— these tests render a real PDF; they need the typst binary. In the backend image
// (and on a dev host with `brew install typst`) it is present. Absent → skip loudly, NOT a silent
// green: the image build installs typst so CI exercises this for real.
func requireTypst(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("typst"); err != nil {
		t.Skip("typst not on PATH — install it (image does) to run the resume render tests")
	}
}

func sampleContent() *jobsmodel.ResumeContent {
	end := "2022-11"
	return &jobsmodel.ResumeContent{
		Identity: jobsmodel.ResumeIdentity{
			Name: "Sijie Wang", Email: "sijie@example.com", Phone: "+1 555 0142",
			LocationLine: "Hamilton, ON", Site: "sijie.xyz",
		},
		Summary: "Backend engineer who builds trustworthy natural-language software.",
		Works: []jobsmodel.ResumeWork{
			{
				Title: "Senior Backend Engineer", Company: "Northwind Logistics",
				Location: "Hamilton, ON",
				Period:   jobsmodel.ResumePeriod{Start: "2019-03", End: &end},
				Bullets:  []string{"Owned the dispatch pipeline and its verification harness."},
			},
		},
		Educations: []jobsmodel.ResumeEducation{
			{
				School: "University of Waterloo", Degree: "B.A.Sc. Software Engineering",
				Period: jobsmodel.ResumePeriod{Start: "2014", End: new("2019")},
			},
		},
		Skills: []jobsmodel.ResumeSkillSet{{Category: "Languages", Items: []string{"Go", "Rust"}}},
	}
}

// extractText —— pull the text layer out of a PDF, so assertions read the OUTPUT, not just
// "a PDF came back".
func extractText(t *testing.T, b []byte) string {
	t.Helper()
	r, err := pdf.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("open rendered pdf: %v", err)
	}
	buf, err := r.GetPlainText()
	if err != nil {
		t.Fatalf("extract text: %v", err)
	}
	var out bytes.Buffer
	if _, cerr := out.ReadFrom(buf); cerr != nil {
		t.Fatalf("read text: %v", cerr)
	}
	return out.String()
}

func mustContain(t *testing.T, text, want, ctx string) {
	t.Helper()
	if !strings.Contains(text, want) {
		t.Errorf("%s: missing %q", ctx, want)
	}
}

// TestRender_puts_the_content_in_the_pdf —— the render actually carries the résumé's facts:
// employer, dates, a bullet, education, and the job role. Not "it didn't error".
func TestRender_puts_the_content_in_the_pdf(t *testing.T) {
	requireTypst(t)
	t.Parallel()
	pdfBytes, err := resumepdf.New("", "").Render(context.Background(), sampleContent(),
		resumepdf.RenderOptions{
			Role: "Staff Backend Engineer", Company: "Acme",
			QRURL: "https://sijie.xyz/?code=HIRE-ABC",
		})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !bytes.HasPrefix(pdfBytes, []byte("%PDF")) {
		t.Fatalf("not a PDF (prefix %q)", pdfBytes[:min(8, len(pdfBytes))])
	}
	text := extractText(t, pdfBytes)
	for _, want := range []string{
		"Northwind Logistics", "2019-03", "dispatch pipeline",
		"University of Waterloo", "Staff Backend Engineer",
	} {
		mustContain(t, text, want, "rendered resume")
	}
}

// TestRender_customization_is_template_choice —— customization = picking a template. Every template
// renders the SAME content (only the layout changes); an unknown template is a clear error, never a
// blank PDF. This is the "定制化" primitive: presentation varies, content doesn't.
func TestRender_customization_is_template_choice(t *testing.T) {
	requireTypst(t)
	t.Parallel()
	names := resumepdf.Templates()
	if len(names) < 2 {
		t.Fatalf("expected at least 2 templates to customize between, got %v", names)
	}
	for _, tmpl := range names {
		assertRendersContent(t, tmpl)
	}
	if _, err := resumepdf.New("", "").Render(
		context.Background(), sampleContent(), resumepdf.RenderOptions{Template: "no-such-theme"},
	); !errors.Is(err, resumepdf.ErrUnknownTemplate) {
		t.Errorf("unknown template should give ErrUnknownTemplate, got %v", err)
	}
}

// assertRendersContent —— one template renders the sample and keeps its content.
func assertRendersContent(t *testing.T, tmpl string) {
	t.Helper()
	pdfBytes, err := resumepdf.New("", "").Render(context.Background(), sampleContent(),
		resumepdf.RenderOptions{Template: tmpl, Role: "Staff Backend Engineer", Company: "Acme"})
	if err != nil {
		t.Fatalf("render under template %q: %v", tmpl, err)
	}
	text := extractText(t, pdfBytes)
	mustContain(t, text, "Northwind Logistics", "template "+tmpl)
	mustContain(t, text, "University of Waterloo", "template "+tmpl)
}

// TestRender_qr_is_a_mandatory_server_widget —— the per-application URL is server-supplied and
// shows on EVERY template, and the owner's content can't change it. A field smuggling a different
// URL doesn't become the widget's URL — the render param wins.
func TestRender_qr_is_a_mandatory_server_widget(t *testing.T) {
	requireTypst(t)
	t.Parallel()
	const realURL = "https://sijie.xyz/?code=REAL-ONE"
	c := sampleContent()
	c.Identity.Site = "evil.example"
	c.Summary = "scan https://evil.example now"
	for _, tmpl := range resumepdf.Templates() {
		pdfBytes, err := resumepdf.New("", "").Render(context.Background(), c,
			resumepdf.RenderOptions{Template: tmpl, Role: "Eng", Company: "Acme", QRURL: realURL})
		if err != nil {
			t.Fatalf("template %q: %v", tmpl, err)
		}
		mustContain(t, extractText(t, pdfBytes), realURL, "template "+tmpl+" server URL")
	}
}

// TestRender_content_cannot_inject_typst —— a résumé field containing Typst markup must render
// LITERALLY, never execute (parameter-binding, not string-splicing). If `#lorem(200)` executed it
// would spray lorem-ipsum ("dolor…"); it must instead appear verbatim.
func TestRender_content_cannot_inject_typst(t *testing.T) {
	requireTypst(t)
	t.Parallel()
	c := sampleContent()
	c.Summary = "#lorem(200) and $x^2$ are not code"
	pdfBytes, err := resumepdf.New("", "").Render(context.Background(), c,
		resumepdf.RenderOptions{Role: "R", Company: "Co"})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	text := extractText(t, pdfBytes)
	mustContain(t, text, "#lorem(200)", "injected Typst rendered literally")
	if strings.Contains(strings.ToLower(text), "dolor") {
		t.Error("injected #lorem executed (found lorem-ipsum output) — content is not escaped")
	}
}
