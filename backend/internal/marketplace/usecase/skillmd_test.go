package usecase

import (
	"strings"
	"testing"
)

// parseSkillMD 是 install 的核心:把 SKILL.md frontmatter + body 拆成 install 字段。
// 锁三件事:inline allowed-tools、block-list allowed-tools、无 frontmatter 时整体即
// body。fetch(HTTP/base64)走 install e2e(marketplace install spec)。

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

func TestParseSkillMDNoFrontmatter(t *testing.T) {
	t.Parallel()
	raw := "just a prompt, no frontmatter"
	got := parseSkillMD(raw)
	eq(t, "prompt", got.Prompt, raw)
	eq(t, "name", got.Name, "")
	eq(t, "tools", strings.Join(got.AllowedTools, ","), "")
}
