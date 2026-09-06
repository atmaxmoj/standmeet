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

// Font-scale reflow test knobs: enough extra works to cross a page boundary, and two scales far
// enough apart that the page count must differ. Left-width knobs: a narrow vs wide left column, far
// enough apart that the main column's wrapping (and page count) must differ.
const (
	heavyExtraWorks = 9
	smallScale      = 0.7
	largeScale      = 2.0
	leftNarrowW     = 0.4
	leftWideW       = 3.5
)

// mustRender —— render or fail; trims the boilerplate from the multi-render layout tests.
func mustRender(t *testing.T, c *jobsmodel.ResumeContent, opts resumepdf.RenderOptions) []byte {
	t.Helper()
	b, err := resumepdf.New("", "").Render(context.Background(), c, opts)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	return b
}

// contentWithLeftSections —— the sample plus a custom section, so all three left-rail sections
// (skills / education / custom) are present to reorder.
func contentWithLeftSections() *jobsmodel.ResumeContent {
	c := sampleContent()
	c.Custom = []jobsmodel.ResumeCustom{{Label: "Certifications", Value: "AWS SAA"}}
	return c
}

// TestRender_left_order_reorders_sections —— left_order drives the on-page order of the left-rail
// sections: reversing it flips which heading comes first in the PDF text. A template that ignored
// left_order (fixed order) would go red. Covers Spec 2 section-drag.
func TestRender_left_order_reorders_sections(t *testing.T) {
	requireTypst(t)
	t.Parallel()
	forward := contentWithLeftSections()
	forward.LeftOrder = []string{"skills", "education", "custom"}
	reversed := contentWithLeftSections()
	reversed.LeftOrder = []string{"custom", "education", "skills"}
	opts := resumepdf.RenderOptions{Role: "Eng", Company: "Acme"}
	ft := extractText(t, mustRender(t, forward, opts))
	rt := extractText(t, mustRender(t, reversed, opts))
	if strings.Index(ft, "SKILLS") >= strings.Index(ft, "EDUCATION") {
		t.Error("forward left_order: SKILLS should print before EDUCATION")
	}
	if strings.Index(rt, "EDUCATION") >= strings.Index(rt, "SKILLS") {
		t.Error("reversed left_order: EDUCATION should print before SKILLS")
	}
}

// TestRender_left_width_narrows_the_main_column —— a wider left column (larger left_width) leaves
// the main experience column narrower, so its bullets wrap more and the résumé takes more pages.
// Reads the artifact (page count); a template that ignored left_width would go red. Spec 2 resize.
func TestRender_left_width_narrows_the_main_column(t *testing.T) {
	requireTypst(t)
	t.Parallel()
	narrowLeft := heavyContent() // narrow left col → wide main → fewer pages
	narrowLeft.LeftWidth = leftNarrowW
	wideLeft := heavyContent() // wide left col → narrow main → more pages
	wideLeft.LeftWidth = leftWideW
	opts := resumepdf.RenderOptions{Role: "Eng", Company: "Acme"}
	np := pageCount(t, mustRender(t, narrowLeft, opts))
	wp := pageCount(t, mustRender(t, wideLeft, opts))
	if wp <= np {
		t.Errorf("wider left column should add pages: narrow=%d, wide=%d", np, wp)
	}
}

// heavyContent —— the sample fattened with many works × bullets, so a change in font size crosses a
// page boundary decisively (a sparse résumé fits one page at almost any scale).
func heavyContent() *jobsmodel.ResumeContent {
	c := sampleContent()
	base := c.Works[0]
	bullets := []string{
		"Owned the dispatch pipeline and its verification harness across three regions and teams.",
		"Cut p99 latency across the ingestion tier under real production load during peak season.",
		"Mentored a squad of engineers and ran the weekly on-call rotation and incident review.",
		"Shipped the reconciliation service end to end with an exhaustive integration test suite.",
	}
	for range heavyExtraWorks {
		c.Works = append(c.Works, jobsmodel.ResumeWork{
			Title: base.Title, Company: base.Company, Location: base.Location,
			Period: base.Period, Bullets: bullets,
		})
	}
	return c
}

// pageCount —— how many pages the rendered PDF has, so a layout change (font size reflowing the
// content) can be asserted on the artifact, not on a stored field.
func pageCount(t *testing.T, b []byte) int {
	t.Helper()
	r, err := pdf.NewReader(bytes.NewReader(b), int64(len(b)))
	if err != nil {
		t.Fatalf("open rendered pdf: %v", err)
	}
	return r.NumPage()
}

// TestRender_font_scale_reflows_the_document —— font_scale is a real size knob, not a stored no-op:
// the SAME content rendered larger takes MORE pages than rendered smaller. Reads the artifact (page
// count), so a template that ignored data.font_scale would go red. Covers Spec 2 font-size.
func TestRender_font_scale_reflows_the_document(t *testing.T) {
	requireTypst(t)
	t.Parallel()
	small, large := heavyContent(), heavyContent()
	small.FontScale = smallScale
	large.FontScale = largeScale
	opts := resumepdf.RenderOptions{Role: "Eng", Company: "Acme"}
	sb, err := resumepdf.New("", "").Render(context.Background(), small, opts)
	if err != nil {
		t.Fatalf("render small: %v", err)
	}
	lb, err := resumepdf.New("", "").Render(context.Background(), large, opts)
	if err != nil {
		t.Fatalf("render large: %v", err)
	}
	sp, lp := pageCount(t, sb), pageCount(t, lb)
	if lp <= sp {
		t.Errorf("larger font_scale must take more pages: small=%d, large=%d", sp, lp)
	}
	mustContain(t, extractText(t, lb), "Northwind Logistics", "large-scale render has content")
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
// blank PDF. This is the "customization" primitive: presentation varies, content doesn't.
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
