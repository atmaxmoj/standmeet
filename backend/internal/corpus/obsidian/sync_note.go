// sync_note.go -- fault-tolerant frontmatter parsing for vault sync.
// Matches the real vault's .scripts contract: frontmatter tolerates
// malformed input without crashing (aligned with F). `[[link]]` extraction
// reuses corpus.ExtractCrossLinks (already aligned with check-links.sh).

package obsidian

import (
	"regexp"
	"strings"
)

// corpFM -- the essential frontmatter of one corp note (sync only cares
// about these fields; other keys are ignored, no error).
type corpFM struct {
	LangLabels map[string]string
	Excerpt    string
	Visibility string
	Lang       string
	Tags       []string
	CSSClasses []string
	Aliases    []string
	Publish    bool
	// PublishSet -- whether the frontmatter **has** a publish key at all.
	//
	// Absence is not negation. None of the real vault's 574 wiki notes have
	// a publish key, and publishing is an edit the owner makes on the web;
	// reading "unsaid" as false would let a single sync take the entire
	// site down (F-L-22). So the missing key leaves the current state
	// untouched, and export writes `publish: %t` back in -- once it's
	// filled in, the next round trip is explicit.
	PublishSet bool
}

// parsedNote -- the result of parseCorpNote (avoids the multiple-named vs.
// unnamed return debate).
type parsedNote struct {
	body string
	// rawFM -- the frontmatter's original text (fence excluded). Parsing
	// drops keys and forms it doesn't recognize, but export has to send
	// the owner's writing back verbatim, so the original text must be
	// carried along too (F-L-67).
	rawFM string
	fm    corpFM
}

// parseCorpNote -- fault-tolerantly splits frontmatter + body (reuses the
// package's SplitFrontmatter: only recognizes the file's leading
// `---\n...\n---` block, falls back to treating everything as body if that
// fails, and doesn't mistake a `---` horizontal rule in body for a closing
// fence), then fault-tolerantly parses the frontmatter.
func parseCorpNote(raw []byte) parsedNote {
	text := strings.ReplaceAll(string(raw), "\r\n", newline)
	text = strings.ReplaceAll(text, "\r", newline)
	s := SplitFrontmatter(text)
	return parsedNote{fm: parseFMLines(s.YAML), body: s.Body, rawFM: s.YAML}
}

var reListItem = regexp.MustCompile(`^\s*-\s*(.+?)\s*$`)

// parseFMLines -- line-based fault-tolerant parsing. key: value; tags
// supports list / inline array / comma-separated string / single value;
// publish and its old name seo_indexed both coerce to bool; unknown keys
// are simply ignored (no error). A repeated key, the later one wins.
func parseFMLines(fm string) corpFM {
	out := corpFM{}
	lines := strings.Split(fm, newline)
	for i := range lines {
		kv := splitKV(lines[i])
		if !kv.ok {
			continue
		}
		if into := listFieldOf(&out, kv.key); into != nil {
			*into = parseTags(kv.val, lines, i) // a list-form value looks ahead (indented `- x`)
			continue
		}
		if isLangKey(kv.key) {
			applyLangFM(&out, kv.key, kv.val)
			continue
		}
		applyScalarFM(&out, kv.key, kv.val)
	}
	return out
}

// applyScalarFM -- writes scalar frontmatter (publish/excerpt/visibility +
// old names); an unknown key is ignored, no error.
func applyScalarFM(out *corpFM, key, val string) {
	switch key {
	case "publish", "seo_indexed":
		out.Publish, out.PublishSet = coerceBool(val), true
	case "excerpt", "seo_description":
		out.Excerpt = unquote(val)
	case "visibility":
		out.Visibility = unquote(val)
	default:
	}
}

// kvLine -- the parse result of one frontmatter line.
type kvLine struct {
	key string
	val string
	ok  bool
}

// isTopLevelLine -- a top-level line that's non-empty, unindented, and not
// a list item (only these can possibly be key: value).
func isTopLevelLine(line string) bool {
	return line != "" && line[0] != ' ' && line[0] != '\t' && line[0] != '-'
}

// splitKV -- a top-level `key: value` (key is alphanumeric/underscore/hyphen).
// An indented line (list item, etc.) is not a kv.
func splitKV(line string) kvLine {
	if !isTopLevelLine(line) {
		return kvLine{}
	}
	rawKey, val, found := strings.Cut(line, ":")
	if !found {
		return kvLine{}
	}
	key := strings.TrimSpace(rawKey)
	if key == "" || !isBareKey(key) {
		return kvLine{}
	}
	return kvLine{key: key, val: strings.TrimSpace(val), ok: true}
}

var reBareKey = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

func isBareKey(k string) bool { return reBareKey.MatchString(k) }

// listFieldOf -- for the keys parsed as lists, which field each writes
// into. An unrecognized key returns nil (falls through to the scalar path).
//
// All three keys (tags / cssclasses / aliases) have **exactly the same**
// value shape (inline array / comma-separated string / single value /
// indented list), so they share parseTags; giving each its own if branch
// would just write the same logic three times, and every new list-type
// frontmatter key would push this function's complexity up one more notch.
func listFieldOf(fm *corpFM, key string) *[]string {
	switch key {
	case "tags":
		return &fm.Tags
	case "cssclasses":
		return &fm.CSSClasses
	case "aliases":
		return &fm.Aliases
	default:
		return nil
	}
}

// parseTags -- tags value: inline array `[a, b]` / comma-separated `a, b`
// / single value `a` / empty (-> the following indented `- x` list).
// i only looks ahead for list items (when the main loop later hits an
// indented line it skips it as non-kv, avoiding double processing).
func parseTags(val string, lines []string, i int) []string {
	val = strings.TrimSpace(val)
	if val == "" {
		return consumeListItems(lines, i)
	}
	if after, ok := strings.CutPrefix(val, "["); ok {
		val = strings.TrimSuffix(after, "]")
	}
	return splitCommaTags(val)
}

func consumeListItems(lines []string, i int) []string {
	out := []string{}
	for j := i + 1; j < len(lines); j++ {
		m := reListItem.FindStringSubmatch(lines[j])
		if m == nil {
			break
		}
		if t := strings.TrimSpace(unquote(m[1])); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func splitCommaTags(val string) []string {
	out := []string{}
	for p := range strings.SplitSeq(val, ",") {
		if t := strings.TrimSpace(unquote(p)); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func coerceBool(v string) bool {
	switch strings.ToLower(strings.TrimSpace(unquote(v))) {
	case "true", "yes", "1", "on":
		return true
	}
	return false
}

func unquote(v string) string {
	v = strings.TrimSpace(v)
	if len(v) < 2 {
		return v
	}
	first, last := v[0], v[len(v)-1]
	if first == last && (first == '"' || first == '\'') {
		return v[1 : len(v)-1]
	}
	return v
}

// parseInlineMap -- `{en: EN, zh: Chinese}` or `en: EN, zh: Chinese` -> map.
//
// Only the inline form is recognized: that's how the vault's template
// writes it, and an indented map would need a whole separate lookahead
// path in this line-based parser -- not worth paying that complexity for a
// form nobody actually writes. Unrecognized -> empty map, labels are
// generated from the code.
func parseInlineMap(val string) map[string]string {
	trimmed := strings.TrimSpace(val)
	trimmed = strings.TrimSuffix(strings.TrimPrefix(trimmed, "{"), "}")
	if strings.TrimSpace(trimmed) == "" {
		return map[string]string{}
	}
	out := map[string]string{}
	for pair := range strings.SplitSeq(trimmed, ",") {
		if got := labelPair(pair); got.ok {
			out[got.code] = got.label
		}
	}
	return out
}

// langLabel -- one entry in lang-labels. ok=false means this entry wasn't
// fully written (code or label missing), treated as unwritten.
type langLabel struct {
	code  string
	label string
	ok    bool
}

// labelPair -- `en: EN` -> one entry.
func labelPair(pair string) langLabel {
	k, v, cut := strings.Cut(pair, ":")
	if !cut {
		return langLabel{}
	}
	code := strings.ToLower(strings.Trim(strings.TrimSpace(k), `"'`))
	label := strings.Trim(strings.TrimSpace(v), `"'`)
	return langLabel{code: code, label: label, ok: code != "" && label != ""}
}

// isLangKey -- whether this key belongs to the multilingual branch. Same
// pattern as listFieldOf: dispatch is written outside so that switch
// doesn't grow one notch longer with every added key.
func isLangKey(key string) bool {
	return key == "lang" || key == "lang-labels"
}

// applyLangFM -- the two multilingual frontmatter keys. Pulled out on its
// own so the neighboring switch doesn't keep growing -- it's already
// shaped like "one more notch of complexity per added scalar key".
func applyLangFM(out *corpFM, key, val string) bool {
	switch key {
	case "lang":
		out.Lang = strings.ToLower(strings.TrimSpace(val))
		return true
	case "lang-labels":
		out.LangLabels = parseInlineMap(val)
		return true
	default:
		return false
	}
}
