package usecase

import (
	"strings"
	"testing"
)

// parseSkillMD is install's core: it splits a SKILL.md's frontmatter + body into install
// fields. This locks down three things: inline allowed-tools, block-list allowed-tools,
// and the whole thing being the body when there's no frontmatter. fetch (HTTP/base64) is
// covered by the install e2e (marketplace install spec).

func eq(t *testing.T, label, got, want string) {
	t.Helper()
	if got != want {
		t.Fatalf("%s: got %q want %q", label, got, want)
	}
}

func TestParseSkillMDInlineTools(t *testing.T) {
	t.Parallel()
	raw := "---\nname: TZ Booking\ndescription: book a slot\n" +
		"allowed-tools: [calendar.book, calendar.list]\n---\n" +
		"You help visitors book a meeting.\n"
	got := parseSkillMD(raw)
	eq(t, "name", got.Name, "TZ Booking")
	eq(t, "description", got.Description, "book a slot")
	eq(t, "prompt", strings.TrimSpace(got.Prompt), "You help visitors book a meeting.")
	eq(t, "tools", strings.Join(got.AllowedTools, ","), "calendar.book,calendar.list")
}

func TestParseSkillMDBlockTools(t *testing.T) {
	t.Parallel()
	raw := "---\nname: Reviewer\nallowed-tools:\n  - corpus_search\n  - corpus_read\n---\nbody here"
	got := parseSkillMD(raw)
	eq(t, "tools", strings.Join(got.AllowedTools, ","), "corpus_search,corpus_read")
	eq(t, "prompt", got.Prompt, "body here")
}

// TestParseSkillMDBlockScalar —— a description written as a YAML block scalar must come out as
// the BLOCK, not as the marker. F-F-1: the `Claude Api` card in anthropics/skills renders the
// literal two characters `|-`, because `consume` stored the marker as the value and every
// following indented line has no colon, so `splitKV` returned an empty key and dropped it.
// This is the same shape as the KaTeX and i18n-key leaks — the surface rendering its source.
func TestParseSkillMDBlockScalar(t *testing.T) {
	t.Parallel()
	raw := "---\nname: Claude Api\ndescription: |-\n" +
		"  Guidance for building with the Claude API.\n" +
		"  Covers streaming, tool use, and prompt caching.\nversion: 1.2.0\n---\nbody here"
	got := parseSkillMD(raw)
	eq(t, "description", got.Description,
		"Guidance for building with the Claude API.\n"+
			"Covers streaming, tool use, and prompt caching.")
	// the key AFTER the block must still parse — a block scalar that swallows the rest of the
	// frontmatter would trade one silent loss for another.
	eq(t, "version", got.Version, "1.2.0")
	eq(t, "name", got.Name, "Claude Api")
	eq(t, "prompt", got.Prompt, "body here")
}

// TestParseSkillMDFoldedScalar —— `>` folds its lines into one paragraph (a card description
// written this way must not come back with hard newlines in the middle of a sentence).
func TestParseSkillMDFoldedScalar(t *testing.T) {
	t.Parallel()
	raw := "---\ndescription: >\n  one sentence\n  split over two lines\n---\nbody"
	got := parseSkillMD(raw)
	eq(t, "description", got.Description, "one sentence split over two lines")
}

func TestParseSkillMDNoFrontmatter(t *testing.T) {
	t.Parallel()
	raw := "just a prompt, no frontmatter"
	got := parseSkillMD(raw)
	eq(t, "prompt", got.Prompt, raw)
	eq(t, "name", got.Name, "")
	eq(t, "tools", strings.Join(got.AllowedTools, ","), "")
}
