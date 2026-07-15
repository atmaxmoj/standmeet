package usecases

import (
	"strings"
	"testing"
)

const (
	stubHeadCap    = 12
	stubLinkCap    = 20
	stubLeadCap    = 240
	stubLeadTight  = 20
	cjkRepeat      = 100
	stubCJKRune    = 0x63A7 // 控 — a Han code point, built via rune() to avoid a source literal
	wantHeadings   = 3
	wantOutlinkStr = "engineering,pc-well-founded-recursion,safe-recursion-theorem"
)

const stubBody = `---
tags: [cybernetics, harness]
---

# Recursive harness

> Parent: [[engineering]]

A safe non-primitive recursive harness needs [[pc-well-founded-recursion]] plus per-level
gating. See also [[safe-recursion-theorem]] and [[pc-well-founded-recursion]] again.

## The construction

Thread the needle with well-founded recursion.

### A deeper heading

more prose.`

func TestStubHeadings(t *testing.T) {
	t.Parallel()
	h := extractHeadings(stubBody, stubHeadCap)
	if len(h) != wantHeadings || h[0] != "# Recursive harness" || h[2] != "### A deeper heading" {
		t.Fatalf("headings wrong: %#v", h)
	}
}

func TestStubOutlinksDedupInOrder(t *testing.T) {
	t.Parallel()
	out := extractOutlinkTargets(stubBody, stubLinkCap)
	if strings.Join(out, ",") != wantOutlinkStr {
		t.Fatalf("outlinks wrong: %#v", out)
	}
}

func TestStubLeadIsProseNotStructure(t *testing.T) {
	t.Parallel()
	const wantLeadPrefix = "A safe non-primitive recursive harness needs pc-well-founded-recursion"
	lead := leadLine(stubBody, stubLeadCap)
	if !strings.HasPrefix(lead, wantLeadPrefix) {
		t.Fatalf("lead wrong: %q", lead)
	}
	if strings.Contains(lead, "[[") || strings.Contains(lead, "Parent") {
		t.Fatalf("lead leaked markup/structure: %q", lead)
	}
}

// TestLeadTruncatesOnRuneBoundary —— a long CJK lead is cut without splitting a rune.
func TestLeadTruncatesOnRuneBoundary(t *testing.T) {
	t.Parallel()
	body := "---\ntags: [x]\n---\n\n# Heading\n\n" +
		strings.Repeat(string(rune(stubCJKRune)), cjkRepeat)
	lead := leadLine(body, stubLeadTight)
	if lead == "" || !strings.HasSuffix(lead, "…") || strings.Contains(lead, "�") {
		t.Fatalf("expected clean truncated lead with ellipsis, got %q", lead)
	}
}
