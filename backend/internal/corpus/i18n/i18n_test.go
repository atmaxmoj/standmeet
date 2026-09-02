// i18n_test.go — one line per row of the tolerance table, plus the two parser traps
// that cost real tuition to learn.
//
// These rules are **pure functions over text**, so they are covered exhaustively here;
// the e2e side only checks that the four consumers actually call this function and
// surface its result — eighteen browser round trips to test a string matrix would be
// pointless.
//

package i18n

import (
	"strings"
	"testing"
)

const (
	langEN = "en"
	langZH = "zh"
)

//nolint:gosmopolitan // Chinese sample is the tested object: the other pane of a bilingual note
const twoPanes = `> [!i18n]
> > [!lang] en
> > # Title
> > English prose.
>
> > [!lang] zh
> > # 标题
> > 中文正文。
`

func codesOf(ds []Diagnostic) []string {
	out := make([]string, 0, len(ds))
	for i := range ds {
		out = append(out, ds[i].Code)
	}
	return out
}

func hasCode(ds []Diagnostic, code string) bool {
	for i := range ds {
		if ds[i].Code == code {
			return true
		}
	}
	return false
}

// TestMinimumFormNeedsNoFrontmatter — the contract is the nested callout; it still
// holds even with zero frontmatter written.
func TestMinimumFormNeedsNoFrontmatter(t *testing.T) {
	t.Parallel()
	doc := Parse(twoPanes)
	if len(doc.Langs) != 2 || doc.Langs[0] != langEN || doc.Langs[1] != langZH {
		t.Fatalf("langs inferred from panes = %v, want [en zh]", doc.Langs)
	}
	if ds := Validate(nil, twoPanes); len(ds) != 0 {
		t.Fatalf("the minimum form must be clean, got %v", codesOf(ds))
	}
}

// TestMonolingualNoteIsSilent — most notes have no multilingual block; validation
// must have nothing at all to say there.
func TestMonolingualNoteIsSilent(t *testing.T) {
	t.Parallel()
	body := "# Just a note\n\nOne language, no blocks.\n"
	if ds := Validate(&Frontmatter{Lang: langEN}, body); len(ds) != 0 {
		t.Fatalf("a monolingual note must produce no diagnostics, got %v", codesOf(ds))
	}
	if d := Parse(body); d.Multilingual() {
		t.Fatal("a note without an i18n block is not multilingual")
	}
}

// TestNeutralProseSurvivesBothLanguages — the single most important one: prose
// outside the block is language-neutral, and appears under both languages. This is
// the entire content of "one note ≠ N documents" — an N-documents implementation
// would duplicate it twice, and this test is the only one that tells the two apart.
//
//nolint:gosmopolitan,cyclop // as above; Chinese pane is the target; 2 langs x 2 asserts
func TestNeutralProseSurvivesBothLanguages(t *testing.T) {
	t.Parallel()
	body := "Intro prose.\n\n" + twoPanes + "\nOutro prose.\n"
	doc := Parse(body)
	for _, lang := range []string{langEN, langZH} {
		out := Render(&doc, lang, langEN)
		if !strings.Contains(out, "Intro prose.") || !strings.Contains(out, "Outro prose.") {
			t.Fatalf("neutral prose missing under %q:\n%s", lang, out)
		}
	}
	en := Render(&doc, langEN, langEN)
	if strings.Contains(en, "中文正文") {
		t.Fatal("the other language's prose must not be in the en render at all")
	}
	if !strings.Contains(Render(&doc, langZH, langEN), "中文正文") {
		t.Fatal("zh render must carry the zh pane")
	}
}

// TestSeveralRegionsInOneNote — multiple regions in one note, with neutral prose
// sandwiched between them (the shape of a real sample).
func TestSeveralRegionsInOneNote(t *testing.T) {
	t.Parallel()
	body := twoPanes + "\nBetween the regions.\n\n" + twoPanes
	doc := Parse(body)
	regions := 0
	for i := range doc.Regions {
		if len(doc.Regions[i].Panes) > 0 {
			regions++
		}
	}
	if regions != 2 {
		t.Fatalf("regions = %d, want 2", regions)
	}
	if !strings.Contains(Render(&doc, langZH, langEN), "Between the regions.") {
		t.Fatal("prose between two regions is neutral and must be kept")
	}
}

// TestButtonRowIsDropped — Obsidian's radio-button row is a presentation artifact,
// not content: not one character of it should leak out (neither as a control nor
// as text).
//
//nolint:gosmopolitan // the Chinese label in the button row is a verbatim sample
func TestButtonRowIsDropped(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n" +
		"> <label><input type=\"radio\" name=\"x\" checked>EN</label><label>中文</label>\n" +
		">\n> > [!lang] en\n> > Body.\n"
	out := Render(doc(body), langEN, langEN)
	for _, leak := range []string{"<label", "<input", "radio", "checked"} {
		if strings.Contains(out, leak) {
			t.Fatalf("button-row markup leaked (%q) into:\n%s", leak, out)
		}
	}
}

// TestFenceHidesAMarker — a `[!i18n]` inside a fenced code block is not a region
// (that's exactly the shape in tikz snippets / tutorials).
func TestFenceHidesAMarker(t *testing.T) {
	t.Parallel()
	body := "Example:\n\n```markdown\n> [!i18n]\n> > [!lang] en\n> > x\n```\n\nDone.\n"
	if d := Parse(body); d.Multilingual() {
		t.Fatal("a marker inside a fenced block must not make the note multilingual")
	}
	if ds := Validate(nil, body); len(ds) != 0 {
		t.Fatalf("nothing to diagnose inside a code fence, got %v", codesOf(ds))
	}
}

// TestNestedCalloutInsideAPaneStaysInside — a pane can nest another callout inside it
// (templates do have i18n > lang > tip). Something at depth 3 is not a new pane.
func TestNestedCalloutInsideAPaneStaysInside(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > # T\n> > > [!tip] Note\n> > > inner\n"
	doc := Parse(body)
	if len(doc.Langs) != 1 {
		t.Fatalf("langs = %v, want exactly [en]", doc.Langs)
	}
	out := Render(&doc, langEN, langEN)
	if !strings.Contains(out, "> [!tip] Note") {
		t.Fatalf("the nested callout must survive inside the pane:\n%s", out)
	}
}

// — the tolerance table —

func TestLangsDisagreeingWithPanesTrustsThePanes(t *testing.T) {
	t.Parallel()
	fm := &Frontmatter{Lang: langEN, Langs: []string{langEN, langZH, "ja"}}
	ds := Validate(fm, twoPanes)
	if !hasCode(ds, CodeLangsMismatch) {
		t.Fatalf("a mismatch must be reported, got %v", codesOf(ds))
	}
	doc := Parse(twoPanes)
	if got := Resolve(&doc, "ja", langEN); got != langEN {
		t.Fatalf("a declared-but-absent language must fall back to lang, got %q", got)
	}
}

func TestDuplicatePaneKeepsTheFirst(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > first\n>\n> > [!lang] en\n> > second\n"
	ds := Validate(nil, body)
	if !hasCode(ds, CodeDuplicatePane) {
		t.Fatalf("a duplicate pane must warn, got %v", codesOf(ds))
	}
	if HasError(ds) {
		t.Fatal("a duplicate is a warning — the note still renders")
	}
	if out := Render(doc(body), langEN, langEN); !strings.Contains(out, "first") {
		t.Fatalf("the first pane wins, got:\n%s", out)
	}
}

func TestSinglePaneRendersMonolingual(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > only one\n"
	doc := Parse(body)
	if len(doc.Langs) != 1 {
		t.Fatalf("langs = %v", doc.Langs)
	}
	if HasError(Validate(nil, body)) {
		t.Fatal("one pane is a legitimate note, not an error")
	}
}

func TestOrphanPaneWarnsAndDoesNotCrash(t *testing.T) {
	t.Parallel()
	body := "> [!lang] en\n> stray pane\n"
	ds := Validate(nil, body)
	if !hasCode(ds, CodeOrphanLangPane) {
		t.Fatalf("an orphan pane must warn, got %v", codesOf(ds))
	}
	if HasError(ds) {
		t.Fatal("an orphan pane renders as a plain callout — that is not an error")
	}
}

func TestUnknownCodeIsRenderedNotRejected(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > hello\n>\n> > [!lang] fr-CA\n> > bonjour\n"
	if HasError(Validate(nil, body)) {
		t.Fatal("an unrecognised code is still a code — we do not police the list")
	}
	if out := Render(doc(body), "fr-ca", langEN); !strings.Contains(out, "bonjour") {
		t.Fatalf("fr-CA must render, got:\n%s", out)
	}
}

func TestEmptyPaneIsAnError(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > body\n>\n> > [!lang] zh\n"
	ds := Validate(nil, body)
	if !hasCode(ds, CodeEmptyPane) || !HasError(ds) {
		t.Fatalf("an empty pane must be an error, got %v", codesOf(ds))
	}
}

func TestLangsWithoutABlockIsAnError(t *testing.T) {
	t.Parallel()
	fm := &Frontmatter{Lang: langEN, Langs: []string{langEN, langZH}}
	ds := Validate(fm, "# Plain\n\nNo blocks here.\n")
	if !hasCode(ds, CodeLangsWithoutBlock) || !HasError(ds) {
		t.Fatalf("declaring langs with no block must be an error, got %v", codesOf(ds))
	}
}

func TestLangMustHaveAPane(t *testing.T) {
	t.Parallel()
	fm := &Frontmatter{Lang: "de", Langs: []string{langEN, langZH}}
	ds := Validate(fm, twoPanes)
	if !hasCode(ds, CodeLangNotInLangs) {
		t.Fatalf("the fallback language must exist, got %v", codesOf(ds))
	}
}

// — selection and labels —

//nolint:gosmopolitan // the Chinese pane is the sample itself
func TestResolveFallsBackToLangNotToLangsZero(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] zh\n> > 中文\n>\n> > [!lang] en\n> > English\n"
	doc := Parse(body)
	// pane order is zh, en; the identity language is en. Asking for a language that
	// doesn't exist → falls back to en, not zh.
	if got := Resolve(&doc, "de", langEN); got != langEN {
		t.Fatalf("fallback = %q, want the identity language en", got)
	}
	// with no identity language written at all → only then does the first pane win.
	if got := Resolve(&doc, "de", ""); got != langZH {
		t.Fatalf("with no identity language the first pane wins, got %q", got)
	}
}

//nolint:gosmopolitan // the label rule test is precisely about the Chinese spelling
func TestLabelUsesVaultRuleThenBuiltinThenUppercase(t *testing.T) {
	t.Parallel()
	if got := Label(langZH, map[string]string{langZH: "简体中文"}); got != "简体中文" {
		t.Fatalf("lang-labels must win, got %q", got)
	}
	if got := Label(langZH, nil); got != "中文" {
		t.Fatalf("non-Latin scripts get their own name, got %q", got)
	}
	if got := Label("fr", nil); got != "FR" {
		t.Fatalf("plain codes uppercase, got %q", got)
	}
}

// doc — saves writing Parse one more time; takes the address because Render/Resolve
// take pointers.
func doc(body string) *Doc { d := Parse(body); return &d }
