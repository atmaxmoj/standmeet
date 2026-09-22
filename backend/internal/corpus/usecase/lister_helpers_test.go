//nolint:testpackage // white-box: Snippet's cleanup is the unit under test, kept beside it.
package usecase

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// bigCharCount — enough repeats of a 3-byte glyph to overrun the byte cap several times over.
const bigCharCount = 200

// TestSnippetStripsI18nToggleMarkup — the microsite/visitor search leak (seen in prod): a wiki
// body wraps its bilingual toggle as raw `<label><input type="radio">` HTML inside a `> [!i18n]`
// callout, and Snippet used to hand that markup straight to the search widget as the excerpt.
func TestSnippetStripsI18nToggleMarkup(t *testing.T) {
	t.Parallel()
	//nolint:gosmopolitan // the Chinese toggle label is exactly the markup that must be stripped
	body := "> [!i18n]\n" +
		"> <label><input type=\"radio\" name=\"cogsci-lang\" checked>EN</label>" +
		"<label><input type=\"radio\" name=\"cogsci-lang\">中文</label>\n" +
		"> \n" +
		"> Cognitive science is the interdisciplinary study of the mind.\n"
	got := Snippet(body)
	for _, leak := range []string{"<input", "<label", "[!i18n]", "radio", "cogsci-lang"} {
		if strings.Contains(got, leak) {
			t.Fatalf("snippet leaked markup %q: %q", leak, got)
		}
	}
	if !strings.Contains(got, "Cognitive science") {
		t.Fatalf("snippet dropped the actual prose: %q", got)
	}
}

// TestSnippetCutsOnCharacterBoundary — the cap is a byte budget; cutting a 3-byte Chinese glyph
// in half yields invalid UTF-8, which postgres rejects on the way back in.
func TestSnippetCutsOnCharacterBoundary(t *testing.T) {
	t.Parallel()
	//nolint:gosmopolitan // a multibyte glyph is the point: the cut must not split one
	got := Snippet(strings.Repeat("字", bigCharCount))
	if !utf8.ValidString(got) {
		t.Fatalf("snippet cut mid-character (invalid UTF-8): %q", got)
	}
}
