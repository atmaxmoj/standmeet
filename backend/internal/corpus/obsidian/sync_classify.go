// sync_classify.go —— vault 文件批的过滤 + 路由:跳 hidden/非-md/根裸文件/未知顶层;按顶层 folder
// 分流三桶 corp(wiki/subjectivity)/ raw / writing(含附件)。

package obsidian

import "strings"

// fileRoute —— 一个文件的路由结果;ok=false 表示跳过(hidden/非-md/根裸文件/未知顶层)。
type fileRoute struct {
	genre string
	segs  []string
	ok    bool
}

func isSyncableMarkdown(rel string) bool {
	return !isHiddenPath(rel) && strings.HasSuffix(strings.ToLower(rel), ".md")
}

func isSyncGenre(g string) bool { return g == genreRaw || corpGenres[g] }

// routeFile —— 判文件路由到哪个 genre(跳 hidden/非-md/根裸文件/未知顶层)。
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

// vaultBuckets —— 分流后的桶。writing 含附件(非 .md);css = harvest 的 .obsidian CSS config。
// raw 现折进 corp(genre='raw'),不再单独成桶 —— 走同一 node-tree 物化器。
type vaultBuckets struct {
	corp    []vaultNote
	writing []VaultFile
	css     []VaultFile
}

// isObsidianCSS —— .obsidian/snippets/*.css 或 appearance.json(owner CSS config,harvest 不跳)。
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

// classifyVault —— 过滤 hidden;按顶层 folder 分流 corp / raw / writing / css。
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
	if isObsidianCSS(f.RelPath) { // config 层:harvest,先于 hidden 跳
		b.css = append(b.css, *f)
		return
	}
	if isHiddenPath(f.RelPath) {
		return
	}
	if top := topSegment(f.RelPath); top == genreWriting || top == "writings" {
		b.writing = append(b.writing, *f) // 含附件;ImportVault 自己分 .md / attachment
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

// toRawVaultNote —— raw is fm-exempt: the whole file is the body, no frontmatter, never publish.
func toRawVaultNote(f *VaultFile, segs []string) vaultNote {
	return vaultNote{
		genre: genreRaw, sourcePath: f.RelPath, body: string(f.Body),
		segs: normalizeSegs(segs[1:]),
	}
}

func toVaultNote(f *VaultFile, segs []string) vaultNote {
	p := parseCorpNote(f.Body)
	return vaultNote{
		genre: segs[0], sourcePath: f.RelPath, fm: p.fm, body: p.body,
		segs: normalizeSegs(segs[1:]),
	}
}

// normalizeSegs —— 去文件名的 .md;空格 → 连字符(normalize-names 容忍)。
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

// isHiddenPath —— 任一路径段以 . 开头,或是 _templates → 跳过。
func isHiddenPath(rel string) bool {
	for seg := range strings.SplitSeq(rel, "/") {
		if seg == "_templates" || (seg != "" && seg[0] == '.') {
			return true
		}
	}
	return false
}
