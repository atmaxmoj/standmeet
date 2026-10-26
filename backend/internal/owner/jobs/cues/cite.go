// cite.go —— turning the model's text into a finished card with an honest citation. The card is
// the server's to classify, never the model's (cue-generic-fabrication-fix): finalize enforces the
// two-state invariant (grounded + stamped From, XOR generic + canonical marker) on both the marker
// and the body, resolves a short USED name to its full source path (R1), and replaces a would-be-
// generic card that still reads as personal with a gap-admission (R2). cue.go streams the result.

package cues

import (
	"regexp"
	"slices"
	"strings"
)

var (
	// usedLineRE / fromLineRE —— the card's machine lines. The model declares which notes it used
	// on a USED line; it must not write a From line, and any it writes is stripped and replaced.
	usedLineRE = regexp.MustCompile(`(?mi)^[ \t]*used:[ \t]*(.*?)[ \t]*$`)
	fromLineRE = regexp.MustCompile(`(?mi)^[ \t]*_?from:[ \t]*(.*?)_?[ \t]*$`)
)

// genericMarker —— the substring every marker variant carries; genericMarkerLine is the one
// canonical line the server writes (R3). A generic card's answer is general judgment, no From.
const (
	genericMarker     = "not from your notes"
	genericMarkerLine = "_General — not from your notes._"
	// postingCitation —— the From for a process answer drawn from the role's posting (H2); the
	// posting is a provided source, so the card is grounded, not general judgment.
	postingCitation = "the role's posting"
	// gapAdmissionCard —— the safe card when a would-be-generic answer still carries personal
	// content (R2 floor): it admits the gap, with no first person, no project name, no From.
	gapAdmissionCard = genericMarkerLine + "\n\n**Key: not in your notes**\nYour notes don't " +
		"record this — answer it from your own general experience, in your own words."
)

var (
	// postingRE —— a USED declaration that the answer came from the role's posting/packet (H2).
	postingRE = regexp.MustCompile(`(?i)\b(posting|packet)\b`)
	// markerLineRE —— any marker line the model wrote, in any wrapper (underscore/asterisk/bare);
	// stripped so finalize stamps the one canonical line (R3).
	markerLineRE = regexp.MustCompile(
		`(?mi)^[ \t]*[_*]*\s*general\s*[—–-][^\n]*not from your notes[^\n]*$`,
	)
	// firstPersonRE / dateRE —— generic-body tripwires (R2): a generic answer must not narrate the
	// owner's own experience or carry a specific date. The cue addresses the owner as "you", so
	// SINGULAR first person (I / my / mine) is the owner's own voice = a personal account;
	// inclusive "we"/"our" (generic advice) and second-person "you" are fine.
	firstPersonRE = regexp.MustCompile(`(?i)\b(i|i['’]m|i['’]ve|i['’]d|my|mine)\b`)
	dateRE        = regexp.MustCompile(`\b\d{4}-\d{2}-\d{2}\b`)
	// keyRE —— the card proper starts at its Key line; anything before it is model preamble
	// ("this is a general question, so I'll …") and is dropped so it can't trip the tripwires.
	keyRE = regexp.MustCompile(`(?i)\*\*key:`)
)

// finished —— a finalised card and the citation metadata a verifier reads (follow-up #2 C / R4).
// downgrade: "" (grounded), marker_present, used_unmatched, used_empty, or a tripwire reason
// (first_person | date | own_project) for a gap-admission.
type finished struct {
	card      string
	mode      string // "generic" | "grounded"
	downgrade string
	from      []string
}

// cueCtx —— what finalize needs besides the model's text to classify and cite a card.
type cueCtx struct {
	posting       string   // "the role's posting" when the packet had posted facts, else ""
	sources       []string // the retrieved note paths (From ⊆ sources, absolute)
	namedProjects []string // project slugs the question named (a project note cites only if named)
}

// finalize —— the citation is the server's, never the model's (F-2). It enforces the two-state
// invariant on BOTH the marker AND the body (the 2026-10-25 错配 spec): a card is EITHER grounded
// (a non-empty stamped From, no marker) OR generic (the canonical marker, no From, no personal
// content). A would-be-generic card whose body still narrates the owner's own experience (first
// person, a specific date) is NOT shipped with a lying marker — it becomes a gap-admission (R2).
func finalize(text string, c *cueCtx) finished {
	raw := stripControl(text)
	marked := strings.Contains(strings.ToLower(raw), genericMarker)
	body := dropPreamble(strings.TrimSpace(markerLineRE.ReplaceAllString(raw, ""))) // R3 + preamble
	if !marked {
		if cites := citedFrom(text, c); len(cites) > 0 {
			from := "\n\n_From: " + strings.Join(cites, ", ") + "_"
			return finished{card: body + from, mode: "grounded", from: cites}
		}
	}
	if leak := personalLeak(body); leak != "" {
		return finished{card: gapAdmissionCard, mode: "generic", downgrade: leak}
	}
	return finished{
		card: genericMarkerLine + "\n\n" + body, mode: "generic",
		downgrade: genericReason(text, marked),
	}
}

// dropPreamble —— the card proper from its Key line on; any chatter the model wrote before the Key
// ("this is a general question, so I'll …") is removed so it cannot trip the body tripwires.
func dropPreamble(body string) string {
	if loc := keyRE.FindStringIndex(body); len(loc) == 2 && loc[0] > 0 {
		return strings.TrimSpace(body[loc[0]:])
	}
	return body
}

// citedFrom —— the From a grounded card would carry: the resolved, named-gated note paths, plus the
// role's posting when a process answer declared it (H2).
func citedFrom(text string, c *cueCtx) []string {
	cites := groundedCitations(usedPaths(text, c.sources), c.namedProjects)
	if c.posting != "" && usedPosting(text) {
		cites = append(cites, c.posting)
	}
	return cites
}

// personalLeak —— the tripwire reason a would-be-generic body actually narrates the owner's own
// experience (R2), or "" when it reads as general judgment. A generic card that trips is replaced
// by a gap-admission. Naming a project is NOT a tripwire: a gap-admission must name the project to
// deny it ("Larkspur has no such metric"), and general advice may reference one as an example;
// first person and a specific date are the signals of a personal account.
func personalLeak(body string) string {
	if firstPersonRE.MatchString(body) {
		return "first_person"
	}
	if dateRE.MatchString(body) {
		return "date"
	}
	return ""
}

// genericReason —— why a clean generic card is generic (R4), for the citation metadata.
func genericReason(text string, marked bool) string {
	switch {
	case marked:
		return "marker_present"
	case len(declaredUsed(text)) > 0:
		return "used_unmatched" // the model declared sources, none resolved
	default:
		return "used_empty"
	}
}

// posting —— the citation for the role's posting when the packet carried posted facts, else "".
func (b *built) posting() string {
	if b.hasPosting {
		return postingCitation
	}
	return ""
}

// usedPosting —— the model declared on its USED line that it answered from the role's posting.
func usedPosting(text string) bool {
	m := usedLineRE.FindStringSubmatch(text)
	return len(m) > 1 && postingRE.MatchString(m[1])
}

// declaredUsed —— the note paths the model named on its USED line, raw (parens trimmed, "none"
// dropped), before any filtering. For the verifier to spot a card whose content is grounded but
// whose declaration is empty (follow-up #2 proposal B/C).
func declaredUsed(text string) []string {
	out := []string{}
	m := usedLineRE.FindStringSubmatch(text)
	if m == nil {
		return out
	}
	for raw := range strings.SplitSeq(m[1], ",") {
		if p := strings.Trim(raw, " \t()"); p != "" && !strings.EqualFold(p, "none") {
			out = append(out, p)
		}
	}
	return out
}

// groundedCitations —— the used paths that may show as a grounded From: every non-project note, and
// a project note (software/project/<slug>) only when the question named that project (G2).
// An unnamed project's note is adjacent — it shares a word, it is not the answer to THIS question.
func groundedCitations(used, namedProjects []string) []string {
	named := make(map[string]bool, len(namedProjects))
	for _, s := range namedProjects {
		named[s] = true
	}
	kept := []string{}
	for _, p := range used {
		if strings.HasPrefix(p, "software/project/") && !named[projectSlug(p)] {
			continue
		}
		kept = append(kept, p)
	}
	return kept
}

// stripControl —— the card without its machine lines (any model From line, the USED declaration):
// what a reader sees. Used mid-stream and before stamping.
func stripControl(text string) string {
	t := fromLineRE.ReplaceAllString(text, "")
	t = usedLineRE.ReplaceAllString(t, "")
	return strings.TrimSpace(t)
}

// usedPaths —— the real source paths the model's USED line names. A path the model invents is not
// in sources and is dropped (From ⊆ sources stays absolute). A token resolves by an exact full-path
// match, else a UNIQUE segment-aligned suffix match: the model writes "deployment", sources hold
// "software/project/standmeet/architecture/deployment" (R1, so a short name does not force a false
// downgrade). An ambiguous tail (shared by >1 source) does not match.
func usedPaths(text string, sources []string) []string {
	out := []string{}
	m := usedLineRE.FindStringSubmatch(text)
	if m == nil {
		return out
	}
	seen := map[string]bool{}
	for raw := range strings.SplitSeq(m[1], ",") {
		if p := resolveToken(raw, sources); p != "" && !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	return out
}

// resolveToken —— the source one raw USED entry names, or "". It tolerates a "(…)" header wrapper
// and skips the "none" sentinel.
func resolveToken(raw string, sources []string) string {
	tok := strings.Trim(raw, " \t()")
	if tok == "" || strings.EqualFold(tok, "none") {
		return ""
	}
	if slices.Contains(sources, tok) {
		return tok // exact full-path match (R1)
	}
	return uniqueSuffix("/"+tok, sources)
}

// uniqueSuffix —— the one source ending in suf, or "" when none or more than one does (an ambiguous
// tail does not resolve — R1 does not guess).
func uniqueSuffix(suf string, sources []string) string {
	hit := ""
	for _, s := range sources {
		if !strings.HasSuffix(s, suf) {
			continue
		}
		if hit != "" {
			return ""
		}
		hit = s
	}
	return hit
}

// fromLine —— the citation content of a finished card's From line, or "" when it carries none.
func fromLine(card string) string {
	if m := fromLineRE.FindStringSubmatch(card); m != nil {
		return m[1]
	}
	return ""
}
