// wiki_crosslink.go — render-time rewrite of Obsidian `[[Title]]` links inside a wiki body.
// Mirrors crosslink.go (writings), but wiki has no slug: it resolves by title only, and the
// target is the tree-derived path → `[Title](/wiki/<path>)`. Storage always keeps the raw
// `[[X]]` (whatever the owner wrote), and the rewrite happens only at read time; an unresolved
// link falls back to plain text (F-L-25: brackets never leak out of this layer).
//
// Parsing and extraction reuse crosslink.go's ExtractCrossLinks / HasCrossLinks / CrossLinkRef.

package usecase

import (
	"context"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// wikiLinkPrefix — the markdown link prefix produced by the rewrite (reader route /wiki/<path>).
const wikiLinkPrefix = "/wiki/"

// WikiPathTitle — a wiki's title + tree-derived path, used for `[[Title]]` resolution.
type WikiPathTitle struct {
	Title string
	Path  string
}

// RewriteWikiCrossLinksForRender — public wiki landing render: every `[[Title]]` (or
// `[[Title|alias]]`) in the body is resolved by title (case-insensitive) to the wiki's
// tree-derived path and swapped for `[display text](/wiki/<path>)`. An unresolved link falls
// back to plain text — see crosslink.go's unresolvedCrossLinkText (shared by both readers).
func RewriteWikiCrossLinksForRender(body string, index []WikiPathTitle) string {
	if !HasCrossLinks(body) {
		return body
	}
	// An empty index is **not** grounds for an early return (F-L-25): an instance where every
	// entry is gated takes exactly this path, and an early return would leak the whole body's
	// `[[X]]` verbatim to the visitor — a different door onto the same defect as a single
	// unresolved link. Proceed normally on an empty index: every link fails to resolve, so
	// every link falls back to plain text.
	byTitle := indexWikiByTitle(index)
	refs := ExtractCrossLinks(body)
	for i := range refs {
		body = applyOneWikiRewrite(body, &refs[i], byTitle)
	}
	return body
}

func indexWikiByTitle(index []WikiPathTitle) map[string]*WikiPathTitle {
	out := make(map[string]*WikiPathTitle, len(index))
	for i := range index {
		out[strings.ToLower(index[i].Title)] = &index[i]
	}
	return out
}

func applyOneWikiRewrite(
	body string, ref *CrossLinkRef, byTitle map[string]*WikiPathTitle,
) string {
	dst, ok := byTitle[strings.ToLower(ref.Target)]
	if !ok {
		return strings.ReplaceAll(body, ref.Original, unresolvedCrossLinkText(ref))
	}
	display := ref.Alias
	if display == "" {
		display = dst.Title
	}
	replacement := fmt.Sprintf("[%s](%s%s)", display, wikiLinkPrefix, dst.Path)
	return strings.ReplaceAll(body, ref.Original, replacement)
}

// WikiPathTitleIndex — extracts the (title, path) rows usable as link targets from the full
// tree + derived paths. Only published entries qualify: a public link target must be
// reachable, otherwise clicking it 404s.
func WikiPathTitleIndex(wikis []entity.Wiki, paths map[string]string) []WikiPathTitle {
	out := make([]WikiPathTitle, 0, len(wikis))
	for i := range wikis {
		if wikis[i].Published() {
			out = append(out, WikiPathTitle{Title: wikis[i].Title(), Path: paths[wikis[i].ID()]})
		}
	}
	return out
}

// WikiMetaPathTitleIndex — the meta version of WikiPathTitleIndex (no body): landing-page [[X]]
// rendering builds title→path from the full meta set, so deep-entry links don't break either.
//
// F-L-12: **includes every entry, no longer published-only**. Rationale: the old logic ("only
// published, otherwise clicking 404s") was wrong — a gated `/wiki/<path>` renders RestrictedDoc
// (a proper restricted page with a code-entry prompt), not a 404. When the whole corpus is
// gated (published=0), the old logic left the index empty, so RewriteWikiCrossLinksForRender
// returned the body unchanged → `[[theory]]` became dead literal text (breaking core navigation
// for the corpus-as-vault reader). Including every entry: an invited visitor who clicks through
// sees the entry (if in scope), and an anonymous visitor who clicks through lands on
// RestrictedDoc and is prompted for a code — both beat dead literal text. Admission to the
// target entry's **content** is still gated by scope at navigation time (the link only exposes
// title/path, and the title is already literally present in the body, so nothing new leaks).
func WikiMetaPathTitleIndex(
	metas []repo.WikiMeta, paths map[string]string,
) []WikiPathTitle {
	out := make([]WikiPathTitle, 0, len(metas))
	for i := range metas {
		out = append(out, WikiPathTitle{Title: metas[i].Title, Path: paths[metas[i].ID]})
	}
	return out
}

// RebuildNoteRefs — after a note write (promote/create/update), rebuild this note's outgoing
// edges: extract `[[Title]]` from the body → resolve by title to an id in any genre of the
// owner's corpus (**cross-genre**: wiki can reference output/subjectivity) → rewrite note_refs
// (the wiki_refs table already FKs corpus_notes, src/dst can be any genre). Even with no `[[]]`
// the old edges must still be cleared. The edge table is a derived index; it need not share a
// transaction with the write.
func RebuildNoteRefs(
	ctx context.Context, deps Deps, ownerID, srcID, body string,
) error {
	if !HasCrossLinks(body) {
		return clearNoteRefs(ctx, deps, ownerID, srcID)
	}
	// Full set (no cap): [[X]] can point to any entry in any genre of the corpus, and a deep
	// target must resolve to an edge too, otherwise backlink/related silently misses it.
	titles, err := deps.NoteRefs.OwnerNoteTitles(ctx, ownerID)
	if err != nil {
		return fmt.Errorf("list notes for crosslink: %w", err)
	}
	dstIDs := resolveNoteDstIDs(body, titles, srcID)
	if rerr := deps.NoteRefs.ReplaceRefsBySrc(ctx, srcID, ownerID, dstIDs); rerr != nil {
		return fmt.Errorf("rebuild note refs: %w", rerr)
	}
	return nil
}

func clearNoteRefs(ctx context.Context, deps Deps, ownerID, srcID string) error {
	if err := deps.NoteRefs.ReplaceRefsBySrc(ctx, srcID, ownerID, []string{}); err != nil {
		return fmt.Errorf("clear note refs: %w", err)
	}
	return nil
}

// resolveNoteDstIDs — resolves the body's `[[Title]]` links by title (case-insensitive) to
// owner-corpus ids (cross-genre), deduplicated and excluding self-links.
func resolveNoteDstIDs(body string, titles []repo.OwnerNoteTitleRow, selfID string) []string {
	cr := crossResolver{
		byTitle:  noteTitleToCandidates(titles),
		selfID:   selfID,
		srcGenre: genreOfID(titles, selfID),
	}
	refs := ExtractCrossLinks(body)
	seen := make(map[string]struct{}, len(refs))
	out := make([]string, 0, len(refs))
	for i := range refs {
		out = cr.add(out, seen, refs[i].Target)
	}
	return out
}

// crossResolver — the resolution context for one rebuild (candidate index + source id/genre),
// bundled into a receiver to stay under the argument-count limit.
type crossResolver struct {
	byTitle  map[string][]repo.OwnerNoteTitleRow
	selfID   string
	srcGenre string
}

func (cr *crossResolver) add(out []string, seen map[string]struct{}, target string) []string {
	id, ok := pickByProximity(cr.byTitle[strings.ToLower(target)], cr.srcGenre, cr.selfID)
	if !ok {
		return out
	}
	if _, dup := seen[id]; dup {
		return out
	}
	seen[id] = struct{}{}
	return append(out, id)
}

// noteTitleToCandidates — name (lowercased) → every same-name candidate (cross-genre). A name
// is both the title and a **frontmatter alias** — the owner writes links in the vault relying
// on Obsidian's alias resolution, so `[[old name]]` / `[[dynamics of flow toward the fixed
// point]]` both need to resolve to this note. Aliases used to be parsed and then discarded
// (frontmatter.go read them into the struct but nothing consumed them), so this class of link
// broke into a literal string the moment it synced in.
//
// Same-name collisions in the real vault are always cross-genre (wiki/ and raw/ mirror the same
// topic tree), so one name can map to multiple candidates; resolution disambiguates by
// proximity (F-L-10: the old version was a map[title]id with last-write-wins, landing
// arbitrarily on a raw draft and leaving hub-note backlinks entirely empty).
//
// **Aliases go through the same candidate table and the same disambiguation** — do not give
// them a second ranking rule, or this repeats F-L-10. A note's several aliases all point back
// to itself; resolveNoteDstIDs's seen set is what collapses them into one edge.
func noteTitleToCandidates(
	titles []repo.OwnerNoteTitleRow,
) map[string][]repo.OwnerNoteTitleRow {
	m := make(map[string][]repo.OwnerNoteTitleRow, len(titles))
	for i := range titles {
		for _, name := range namesOf(&titles[i]) {
			m[name] = append(m[name], titles[i])
		}
	}
	return m
}

// namesOf — every name a note can be referenced by: title + all aliases (all lowercased). An
// empty alias is skipped — an empty string would otherwise mean "every `[[]]` points here".
func namesOf(row *repo.OwnerNoteTitleRow) []string {
	out := make([]string, 0, 1+len(row.Aliases))
	out = append(out, strings.ToLower(row.Title))
	for _, a := range row.Aliases {
		if trimmed := strings.ToLower(strings.TrimSpace(a)); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func genreOfID(titles []repo.OwnerNoteTitleRow, id string) string {
	for i := range titles {
		if titles[i].ID == id {
			return titles[i].Genre
		}
	}
	return ""
}

// pickByProximity — Obsidian-style disambiguation: **a same-genre (≈ same top-level folder)
// non-self candidate wins**, otherwise the first non-self candidate. genre maps to top-level
// dirs like wiki/ raw/, so preferring same-genre makes a wiki note's [[X]] land on a wiki
// sibling instead of a raw draft. Within one genre, base names are sibling-unique, so there is
// at most one match — no need to compare paths further.
func pickByProximity(
	cands []repo.OwnerNoteTitleRow, srcGenre, selfID string,
) (string, bool) {
	fallback := ""
	for i := range cands {
		if cands[i].ID == selfID {
			continue
		}
		if cands[i].Genre == srcGenre {
			return cands[i].ID, true
		}
		if fallback == "" {
			fallback = cands[i].ID
		}
	}
	return fallback, fallback != ""
}
