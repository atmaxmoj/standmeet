// sync_classify.go —— filtering + routing for a vault file batch: skips hidden / non-md /
// bare root files / unknown top-level folders; routes by top-level folder into three buckets —
// corp (wiki/subjectivity) / raw / writing (includes attachments).

package obsidian

import "strings"

// fileRoute —— the routing result for one file; ok=false means skip
// (hidden / non-md / bare root file / unknown top-level folder).
type fileRoute struct {
	genre string
	segs  []string
	ok    bool
}

func isSyncableMarkdown(rel string) bool {
	return !isHiddenPath(rel) && strings.HasSuffix(strings.ToLower(rel), ".md")
}

func isSyncGenre(g string) bool { return g == genreRaw || corpGenres[g] }

// routeFile —— decides which genre a file routes to
// (skips hidden / non-md / bare root file / unknown top-level folder).
func routeFile(rel string) fileRoute {
	if !isSyncableMarkdown(rel) {
		return fileRoute{}
	}
	segs := strings.Split(rel, "/")
	if len(segs) < 2 || !isSyncGenre(segs[0]) {
		return fileRoute{}
	}
	return fileRoute{genre: segs[0], segs: segs, ok: true}
}

// vaultBuckets —— the buckets after routing. writing includes attachments (non-.md); css is
// the harvested .obsidian CSS config. raw now folds into corp (genre='raw') and is no longer
// its own bucket — it goes through the same node-tree materializer.
type vaultBuckets struct {
	corp    []vaultNote
	writing []VaultFile
	css     []VaultFile
}

// isObsidianCSS —— .obsidian/snippets/*.css or appearance.json
// (owner CSS config; harvested, not skipped).
func isObsidianCSS(rel string) bool {
	if rel == obsidianAppearance {
		return true
	}
	return strings.HasPrefix(rel, obsidianSnippets) && strings.HasSuffix(rel, ".css")
}

const (
	obsidianAppearance = ".obsidian/appearance.json"
	obsidianSnippets   = ".obsidian/snippets/"
)

func topSegment(rel string) string {
	top, _, _ := strings.Cut(rel, "/")
	return top
}

// classifyVault —— filters hidden; routes by top-level folder into corp / raw / writing / css.
func classifyVault(files []VaultFile) vaultBuckets {
	b := vaultBuckets{
		corp: []vaultNote{}, writing: []VaultFile{}, css: []VaultFile{},
	}
	for i := range files {
		classifyOne(&files[i], &b)
	}
	return b
}

func classifyOne(f *VaultFile, b *vaultBuckets) {
	if isObsidianCSS(f.RelPath) { // config layer: harvested, checked before the hidden skip
		b.css = append(b.css, *f)
		return
	}
	if isHiddenPath(f.RelPath) {
		return
	}
	if top := topSegment(f.RelPath); top == genreWriting || top == "writings" {
		// includes attachments; ImportVault splits .md / attachment.
		b.writing = append(b.writing, *f)
		return
	}
	classifyCorpOrRaw(f, b)
}

func classifyCorpOrRaw(f *VaultFile, b *vaultBuckets) {
	rt := routeFile(f.RelPath)
	switch {
	case !rt.ok:
		return
	case rt.genre == genreRaw:
		// raw now folds into the ONE corpus tree (genre='raw'): same node-tree as note, but
		// fm-exempt (whole body, never publish-gated) — the materializer's raw rules handle it.
		b.corp = append(b.corp, toRawVaultNote(f, rt.segs))
	default:
		b.corp = append(b.corp, toVaultNote(f, rt.segs))
	}
}

// toRawVaultNote —— raw is fm-exempt: the whole file is the body, no frontmatter, never gated.
func toRawVaultNote(f *VaultFile, segs []string) vaultNote {
	return vaultNote{
		genre: genreRaw, sourcePath: f.RelPath, body: string(f.Body),
		segs: normalizeSegs(segs[1:]),
	}
}

func toVaultNote(f *VaultFile, segs []string) vaultNote {
	p := parseCorpNote(f.Body)
	return vaultNote{
		genre: segs[0], sourcePath: f.RelPath, fm: p.fm, body: p.body, rawFM: p.rawFM,
		segs: normalizeSegs(segs[1:]),
	}
}

// normalizeSegs —— strips .md off the filename; space → hyphen
// (normalize-names tolerates it).
func normalizeSegs(segs []string) []string {
	out := make([]string, len(segs))
	for i := range segs {
		s := segs[i]
		if i == len(segs)-1 {
			s = strings.TrimSuffix(s, ".md")
		}
		out[i] = strings.ReplaceAll(s, " ", "-")
	}
	return out
}

// isHiddenPath —— skip if any path segment starts with '.', or is _templates.
func isHiddenPath(rel string) bool {
	for seg := range strings.SplitSeq(rel, "/") {
		if seg == "_templates" || (seg != "" && seg[0] == '.') {
			return true
		}
	}
	return false
}
