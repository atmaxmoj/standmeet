// crosslink.go —— parsing + render-time rewrite of `[[X]]` cross-links in writing body_md.
//
// **Storage**: body_md always stores the raw `[[X]]` (whatever the owner wrote is what's
// stored; an Obsidian export round-trip also keeps it literal).
// **At read time (public /writings GET)**: the server pre-resolves `[[X]]` → the real writing
// slug → rewrites body_md into standard markdown `[Title](/writings/<slug>)` before sending it
// to the frontend; anything unresolved stays as literal `[[X]]` text.
// **At write time (SaveWriting)**: in the same tx, extract [[X]] → resolve → rebuild the
// src→dst edge table (writing_refs).
//
// Resolution rule (aligned with Quartz's CrawlLinks):
//  1. First try an exact case-insensitive match on slug
//  2. If no match, fall back to a case-insensitive match on title
//  3. If neither matches: return unresolved, the render side keeps the original [[X]],
//     and the edge table gets no entry for it

package usecase

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// CrossLinkRefScheme —— the literal cross-link prefix in body_md.
const crossLinkOpen = "[["

// crossLinkPattern —— captures `[[X]]` / `[[X|alias]]` / `[[X#heading]]`, and the leading
// `!` (embed). group1 = leading `!` (embed marker), group2 = target (possibly with #heading),
// group3 = optional alias.
// Aligned with check-links.sh: an embed doesn't count as a link, neither does one inside a
// code block/inline code, and #heading only anchors within the same target.
var (
	crossLinkPattern = regexp.MustCompile(`(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]`)
	codeFenceRe      = regexp.MustCompile("(?s)```.*?```")
	inlineCodeRe     = regexp.MustCompile("`[^`]*`")
)

// CrossLinkRef —— one extracted [[...]].
type CrossLinkRef struct {
	Original string // original text (including [[ ]])
	Target   string // target (slug or title, already trimmed, #heading already stripped)
	Alias    string // optional display text (after "|"), empty = use dst's title
}

// ExtractCrossLinks —— all `[[X]]` references in body_md, in order of appearance. Strips
// code blocks/inline code first, skips `![[embed]]`, strips `#heading` (aligned with the
// vault's check-links.sh: none of those count as real links).
func ExtractCrossLinks(body string) []CrossLinkRef {
	stripped := inlineCodeRe.ReplaceAllString(codeFenceRe.ReplaceAllString(body, ""), "")
	matches := crossLinkPattern.FindAllStringSubmatch(stripped, -1)
	out := make([]CrossLinkRef, 0, len(matches))
	for _, m := range matches {
		if ref, ok := crossLinkFromMatch(m); ok {
			out = append(out, ref)
		}
	}
	return out
}

func crossLinkFromMatch(m []string) (CrossLinkRef, bool) {
	if m[1] == "!" { // embed, not a link
		return CrossLinkRef{}, false
	}
	target := strings.TrimSpace(m[2])
	if i := strings.IndexByte(target, '#'); i >= 0 {
		target = strings.TrimSpace(target[:i])
	}
	if target == "" {
		return CrossLinkRef{}, false
	}
	return CrossLinkRef{Original: m[0], Target: target, Alias: strings.TrimSpace(m[3])}, true
}

// ResolvedLink —— one link after resolution. dst nil means unresolved.
type ResolvedLink struct {
	Dst *entity.Writing // nil = unresolved (render side keeps it literal)
	Ref CrossLinkRef
}

// ResolveCrossLinks —— resolves a set of refs to their target writings. candidates is the
// owner's full set of writings (already fetched by the caller, to avoid repeated round-trips).
// Quartz-style rule: slug first (exact, case-insensitive), title as fallback (same normalize).
func ResolveCrossLinks(
	refs []CrossLinkRef, candidates []entity.Writing,
) []ResolvedLink {
	idx := indexCandidates(candidates)
	out := make([]ResolvedLink, 0, len(refs))
	for i := range refs {
		out = append(out, resolveCrossLinkOne(&refs[i], idx))
	}
	return out
}

// writingIndex —— bundles two case-insensitive indexes, by slug and by title.
type writingIndex struct {
	bySlug, byTitle map[string]*entity.Writing
}

func indexCandidates(candidates []entity.Writing) writingIndex {
	idx := writingIndex{
		bySlug:  make(map[string]*entity.Writing, len(candidates)),
		byTitle: make(map[string]*entity.Writing, len(candidates)),
	}
	for i := range candidates {
		idx.bySlug[strings.ToLower(candidates[i].Slug())] = &candidates[i]
		idx.byTitle[strings.ToLower(candidates[i].Title())] = &candidates[i]
	}
	return idx
}

func resolveCrossLinkOne(ref *CrossLinkRef, idx writingIndex) ResolvedLink {
	key := strings.ToLower(ref.Target)
	if dst, ok := idx.bySlug[key]; ok {
		return ResolvedLink{Ref: *ref, Dst: dst}
	}
	if dst, ok := idx.byTitle[key]; ok {
		return ResolvedLink{Ref: *ref, Dst: dst}
	}
	return ResolvedLink{Ref: *ref, Dst: nil}
}

// RewriteCrossLinksToMarkdown —— used by public /writings render: replaces every `[[X]]` in
// body_md with `[display text](/writings/<slug>)`. Unresolved ones stay as literal `[[X]]`.
// Display text: alias takes priority, else dst.Title.
func RewriteCrossLinksToMarkdown(body string, resolved []ResolvedLink) string {
	for i := range resolved {
		r := &resolved[i]
		if r.Dst == nil {
			continue
		}
		display := r.Ref.Alias
		if display == "" {
			display = r.Dst.Title()
		}
		replacement := fmt.Sprintf("[%s](/writings/%s)", display, r.Dst.Slug())
		body = strings.ReplaceAll(body, r.Ref.Original, replacement)
	}
	return body
}

// DedupResolvedDsts —— extracts dst writing.id from a resolved list, deduped (used by
// SaveWriting when writing the writing_refs edge table, to avoid colliding on the (src,dst)
// primary key). Unresolved entries are skipped.
func DedupResolvedDsts(resolved []ResolvedLink) []string {
	seen := make(map[string]struct{}, len(resolved))
	out := make([]string, 0, len(resolved))
	for i := range resolved {
		if resolved[i].Dst == nil {
			continue
		}
		id := resolved[i].Dst.ID()
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// resolveAndDedupForOwner —— convenience wrapper used by SaveWriting: extract refs from
// body → resolve against candidates → output a deduped dst id list (used to rebuild the
// edge table).
func resolveAndDedupForOwner(body string, candidates []entity.Writing) []string {
	refs := ExtractCrossLinks(body)
	if len(refs) == 0 {
		return []string{}
	}
	return DedupResolvedDsts(ResolveCrossLinks(refs, candidates))
}

// HasCrossLinks —— whether body contains any `[[X]]`. Avoids running the candidate list
// query when saving a writing that has no links.
func HasCrossLinks(body string) bool {
	return strings.Contains(body, crossLinkOpen)
}

// RewriteCrossLinksForRender —— used by public /writings GET: resolves `[[X]]` in body_md
// against candidate slug+title → replaces with standard markdown `[Title](/writings/<slug>)`;
// unresolved ones keep the original text.
//
// The same resolution logic as SaveWriting's ResolveCrossLinks, but this only needs
// slug + title (not the full Writing), so it runs its own lightweight index.
func RewriteCrossLinksForRender(body string, index []repo.SlugTitle) string {
	if !HasCrossLinks(body) {
		return body
	}
	// Don't early-return on an empty index — same reasoning as the wiki side (F-L-25): with
	// an empty index every ref fails to resolve, and "unresolved" now has a defined output
	// (plain text), not a raw pass-through leak.
	slim := indexSlugTitle(index)
	refs := ExtractCrossLinks(body)
	for i := range refs {
		body = applyOneCrossLinkRewrite(body, &refs[i], slim)
	}
	return body
}

// slugTitleIndex —— the SlugTitle version of the case-insensitive dual index.
type slugTitleIndex struct {
	bySlug, byTitle map[string]*repo.SlugTitle
}

func indexSlugTitle(index []repo.SlugTitle) slugTitleIndex {
	out := slugTitleIndex{
		bySlug:  make(map[string]*repo.SlugTitle, len(index)),
		byTitle: make(map[string]*repo.SlugTitle, len(index)),
	}
	for i := range index {
		out.bySlug[strings.ToLower(index[i].Slug)] = &index[i]
		out.byTitle[strings.ToLower(index[i].Title)] = &index[i]
	}
	return out
}

func applyOneCrossLinkRewrite(
	body string, ref *CrossLinkRef, idx slugTitleIndex,
) string {
	dst := resolveSlugTitle(ref.Target, idx)
	if dst == nil {
		return strings.ReplaceAll(body, ref.Original, unresolvedCrossLinkText(ref))
	}
	display := ref.Alias
	if display == "" {
		display = dst.Title
	}
	replacement := fmt.Sprintf("[%s](/writings/%s)", display, dst.Slug)
	return strings.ReplaceAll(body, ref.Original, replacement)
}

// unresolvedCrossLinkText —— an unresolvable `[[X]]` falls back to **plain text**, not back
// to the original markup (F-L-25). Both the wiki reader and the writings reader share this:
// each used to `return body` on its own, which leaked the brackets straight to the visitor.
//
// The visitor is not an Obsidian user: `[[ ]]` is authoring machinery, not content. The
// target name is real text the owner wrote, so it stays; the brackets have no reading that's
// useful to a visitor. A target that **exists but isn't readable here** (e.g. genre=raw,
// which has no reader route at all) and a target that **doesn't exist at all** are the same
// thing at this layer — neither becomes a clickable address.
//
// This also pins down the audit side: `[[` appearing on screen now has exactly one meaning —
// **the rewriter didn't run**. The vault-links item's requirement to distinguish "resolver is
// broken" from "link is genuinely dangling" therefore holds automatically, with no need to
// query the database to tell them apart.
func unresolvedCrossLinkText(ref *CrossLinkRef) string {
	if ref.Alias != "" {
		return ref.Alias
	}
	return ref.Target
}

func resolveSlugTitle(target string, idx slugTitleIndex) *repo.SlugTitle {
	key := strings.ToLower(target)
	if dst, ok := idx.bySlug[key]; ok {
		return dst
	}
	if dst, ok := idx.byTitle[key]; ok {
		return dst
	}
	return nil
}
