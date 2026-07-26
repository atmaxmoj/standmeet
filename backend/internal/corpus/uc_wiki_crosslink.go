// wiki_crosslink.go —— wiki body 里 Obsidian `[[Title]]` 的渲染期 rewrite。
// 镜像 crosslink.go(writings),但 wiki 无 slug:只按 title 解析,目标是树派生
// path → `[Title](/wiki/<path>)`。存储永远存原始 `[[X]]`(owner 写啥存啥),读时
// 才 rewrite;unresolved 留 literal 当文字。
//
// 解析与抽取复用 crosslink.go 的 ExtractCrossLinks / HasCrossLinks / CrossLinkRef。

package corpus

import (
	"context"
	"fmt"
	"strings"
)

// wikiLinkPrefix —— rewrite 出来的 markdown 链接前缀(reader 路由 /wiki/<path>)。
const wikiLinkPrefix = "/wiki/"

// WikiPathTitle —— 一条 wiki 的 title + 树派生 path,给 `[[Title]]` 解析用。
type WikiPathTitle struct {
	Title string
	Path  string
}

// RewriteWikiCrossLinksForRender —— public wiki landing render:body 里每条
// `[[Title]]`(或 `[[Title|alias]]`)按 title(case-insensitive)解析到 wiki 的
// 树派生 path,换成 `[显示文本](/wiki/<path>)`。unresolved 留原 `[[X]]`。
func RewriteWikiCrossLinksForRender(body string, index []WikiPathTitle) string {
	if !HasCrossLinks(body) || len(index) == 0 {
		return body
	}
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
		return body
	}
	display := ref.Alias
	if display == "" {
		display = dst.Title
	}
	replacement := fmt.Sprintf("[%s](%s%s)", display, wikiLinkPrefix, dst.Path)
	return strings.ReplaceAll(body, ref.Original, replacement)
}

// WikiPathTitleIndex —— 从全树 + 派生 path 抽出可作链接目标的 (title, path) 列。
// 只收 published:公开链接目标必须可访问,否则点进去 404。
func WikiPathTitleIndex(wikis []Wiki, paths map[string]string) []WikiPathTitle {
	out := make([]WikiPathTitle, 0, len(wikis))
	for i := range wikis {
		if wikis[i].Published() {
			out = append(out, WikiPathTitle{Title: wikis[i].Title(), Path: paths[wikis[i].ID()]})
		}
	}
	return out
}

// WikiMetaPathTitleIndex —— WikiPathTitleIndex 的 meta 版(无 body):landing 渲染 [[X]] 用全量 meta
// 建 title→path,deep entry 的链接也不断。
//
// F-L-12:**收全部条目,不再只收 published**。理由:老逻辑"只收 published,否则点进去 404"是错的 ——
// 一条 gated `/wiki/<path>` 渲的是 RestrictedDoc(带 code-entry 引导的正经受限页),不是 404。全语料
// gated(published=0)时旧逻辑让索引空掉,RewriteWikiCrossLinksForRender 原样返回 → `[[theory]]` 成死
// 字面文本(corpus-as-vault reader 的核心导航失效)。收全部后:受邀访客点进去看到条目(在 scope),匿名
// 访客点进去被 RestrictedDoc 接住去要码 —— 两者都比死字面强。目标条目的**内容**准入仍在导航时按 scope
// 兜(链接只暴露 title/path,而 title 本来就字面写在 body 里,无新泄露)。
func WikiMetaPathTitleIndex(
	metas []WikiMeta, paths map[string]string,
) []WikiPathTitle {
	out := make([]WikiPathTitle, 0, len(metas))
	for i := range metas {
		out = append(out, WikiPathTitle{Title: metas[i].Title, Path: paths[metas[i].ID]})
	}
	return out
}

// RebuildNoteRefs —— note 写后(promote/create/update)重建这条的出度边:抽 body 的 `[[Title]]`
// → 按 title 解析到 owner 语料里任一 genre 的 id（**跨-genre**:wiki 可引用 output/subjectivity）
// → 重写 note_refs（wiki_refs 表已 FK corpus_notes、src/dst 任意 genre）。没 `[[]]` 也要清空旧边。
// 边表是派生索引,不要求跟写同事务。
func RebuildNoteRefs(
	ctx context.Context, deps Deps, ownerID, srcID, body string,
) error {
	if !HasCrossLinks(body) {
		return clearNoteRefs(ctx, deps, ownerID, srcID)
	}
	// 全量(无 cap):[[X]] 可指向语料里任一 genre 的任一条,deep target 也要解析得到边,否则
	// backlink/related 静默漏。
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

// resolveNoteDstIDs —— body 的 `[[Title]]` 按 title(case-insensitive)解析到 owner 语料 id（跨
// genre）,去重 + 排除 self-link。
func resolveNoteDstIDs(body string, titles []OwnerNoteTitleRow, selfID string) []string {
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

// crossResolver —— 一次重建的解析上下文(候选索引 + 源 id/genre),收进 receiver 免 argument-limit。
type crossResolver struct {
	byTitle  map[string][]OwnerNoteTitleRow
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

// noteTitleToCandidates —— title(lower)→ 所有同名候选(跨 genre)。真 vault 的同名碰撞都是跨
// genre(wiki/ 与 raw/ 镜像同一主题树),所以一个 title 可能对多条,解析要按 proximity 消歧
// (F-L-10:旧版是 map[title]id 的 last-write-wins,任意落到 raw 草稿,hub 笔记 backlinks 全空)。
func noteTitleToCandidates(
	titles []OwnerNoteTitleRow,
) map[string][]OwnerNoteTitleRow {
	m := make(map[string][]OwnerNoteTitleRow, len(titles))
	for i := range titles {
		k := strings.ToLower(titles[i].Title)
		m[k] = append(m[k], titles[i])
	}
	return m
}

func genreOfID(titles []OwnerNoteTitleRow, id string) string {
	for i := range titles {
		if titles[i].ID == id {
			return titles[i].Genre
		}
	}
	return ""
}

// pickByProximity —— Obsidian 式歧义消解:**同 genre(≈同顶层文件夹)的非自身候选优先**,否则取
// 第一个非自身候选。genre 映射到 wiki/ raw/ 等顶层目录,所以同 genre 优先就把 wiki 笔记的 [[X]]
// 落到 wiki 兄弟而非 raw 草稿。同 genre 内基名 sibling-unique,故至多一条,无需再比路径。
func pickByProximity(
	cands []OwnerNoteTitleRow, srcGenre, selfID string,
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
