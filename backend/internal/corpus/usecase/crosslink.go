// crosslink.go —— writing body_md 里 `[[X]]` 双链的解析 + 渲染期 rewrite。
//
// **存储**：body_md 永远存原始 `[[X]]`（owner 写啥存啥；Obsidian export
// round-trip 也保 literal）。
// **读时（public /writings GET）**：server pre-resolve `[[X]]` → 真 writing
// slug → rewrite body_md 成 `[Title](/writings/<slug>)` 标准 markdown 再发给
// 前端；不识别的留 literal `[[X]]` 当文字。
// **写时（SaveWriting）**：同 tx 抽 [[X]] → resolve → 把 src→dst 边表
// (writing_refs) 重建。
//
// Resolution 规则（跟 Quartz CrawlLinks 对齐）：
//  1. 先按 slug case-insensitive 精确匹配
//  2. 没中再按 title case-insensitive 匹配
//  3. 都没中：返 unresolved，render 那侧留原 [[X]]，边表不入这条

package usecase

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
	"github.com/atmaxmoj/standmeet/internal/corpus/repo"
)

// CrossLinkRefScheme —— body_md 里的双链字面前缀。
const crossLinkOpen = "[["

// crossLinkPattern —— 抓 `[[X]]` / `[[X|alias]]` / `[[X#heading]]`,并捕前导 `!`(embed)。
// group1 = 前导 `!`(embed 标记),group2 = 目标(含可能的 #heading),group3 = optional alias。
// 对齐 check-links.sh:embed 不算链接、代码块/行内代码里的不算、#heading 只锚同一目标。
var (
	crossLinkPattern = regexp.MustCompile(`(!?)\[\[([^\]|]+)(?:\|([^\]]*))?\]\]`)
	codeFenceRe      = regexp.MustCompile("(?s)```.*?```")
	inlineCodeRe     = regexp.MustCompile("`[^`]*`")
)

// CrossLinkRef —— 抽出来的一条 [[...]]。
type CrossLinkRef struct {
	Original string // 原文（含 [[ ]]）
	Target   string // 目标（slug 或 title，已 trim、已剥 #heading）
	Alias    string // 可选显示文本（"|" 后面），空 = 用 dst 的 title
}

// ExtractCrossLinks —— body_md 里所有 `[[X]]` 引用,按出现顺序。先剥代码块/行内代码,跳 `![[embed]]`,
// 剥 `#heading`(对齐 vault 的 check-links.sh:那些都不是真链接)。
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

// ResolvedLink —— Resolution 完后的一条 link。dst nil 表示 unresolved。
type ResolvedLink struct {
	Dst *entity.Writing // nil = unresolved（render 留 literal）
	Ref CrossLinkRef
}

// ResolveCrossLinks —— 一组 ref 解到对应 writing。candidates 是 owner 的所
// 有 writing（caller 已查过，避免反复 round-trip）。规则 Quartz-style：slug
// 先（case-insensitive 精确），title fallback（同 normalize）。
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

// writingIndex —— slug+title 两张 case-insensitive 索引打包。
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

// RewriteCrossLinksToMarkdown —— public /writings render 用：把 body_md 里
// 每条 `[[X]]` 换成 `[显示文本](/writings/<slug>)`。unresolved 留 literal
// `[[X]]`。显示文本：alias 优先 > dst.Title。
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

// DedupResolvedDsts —— 从 resolved 列表抽 dst writing.id 去重（SaveWriting
// 写 writing_refs 边表时用，避免 (src,dst) 主键撞）。unresolved 跳过。
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

// resolveAndDedupForOwner —— SaveWriting 用的便捷封装：从 body 抽 refs →
// resolve against candidates → 输出去重后的 dst id 列表（用来重建边表）。
func resolveAndDedupForOwner(body string, candidates []entity.Writing) []string {
	refs := ExtractCrossLinks(body)
	if len(refs) == 0 {
		return []string{}
	}
	return DedupResolvedDsts(ResolveCrossLinks(refs, candidates))
}

// HasCrossLinks —— body 里有没有 `[[X]]`。避免没 link 的 writing save 时也
// 跑 candidate list 查询。
func HasCrossLinks(body string) bool {
	return strings.Contains(body, crossLinkOpen)
}

// RewriteCrossLinksForRender —— public /writings GET 用：body_md 里 `[[X]]`
// resolve 到 candidate slug+title → 替换成 `[Title](/writings/<slug>)`
// 标准 markdown；unresolved 留原文。
//
// 跟 SaveWriting 那边走的 ResolveCrossLinks 是同一套 resolver，但只需要 slug
// + title（不需要 full Writing），所以走自己的轻 index。
func RewriteCrossLinksForRender(body string, index []repo.SlugTitle) string {
	if !HasCrossLinks(body) {
		return body
	}
	// 索引为空不早退 —— 理由同 wiki 那一侧(F-L-25):空索引下每条都解析不到,而"解析不到"
	// 现在有确定的产物(纯文本),不再是"原样漏出"。
	slim := indexSlugTitle(index)
	refs := ExtractCrossLinks(body)
	for i := range refs {
		body = applyOneCrossLinkRewrite(body, &refs[i], slim)
	}
	return body
}

// slugTitleIndex —— SlugTitle 版本的 case-insensitive 双索引。
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

// unresolvedCrossLinkText —— 解析不到的 `[[X]]` 退成**纯文本**,不是退成原标记(F-L-25)。
// wiki reader 和 writings reader 共用这一条:两处曾各自 `return body`,于是各自把方括号
// 漏给访客。
//
// 访客不是 Obsidian 用户:`[[ ]]` 是创作机械,不是内容。目标名是 owner 写下的真东西,留着;
// 方括号没有任何一种读法对访客有用。目标**存在但此处读不到**(例:genre=raw,压根没有 reader
// 路由)跟目标**根本不存在**,在这一层是同一件事 —— 两者都变不成可点的地址。
//
// 顺带把审计那一侧钉死:屏幕上再出现 `[[` 就只剩一个含义 —— **重写器没跑**。
// vault-links item 要的「解析器坏了 vs 链接悬空必须能区分」因此自动成立,不必去查库分辨。
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
