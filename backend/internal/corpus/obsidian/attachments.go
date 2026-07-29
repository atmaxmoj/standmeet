// attachments.go —— body_md 里 image 引用的提 / 改写工具。
//
// 处理 4 种 markdown image 写法（前 2 我们 export 输出 / 后 2 owner 在
// Obsidian 写出来的）：
//  1. ![alt](standmeet-asset:<uuid>)   —— StandMeet 内部 URI（无需 rewrite）
//  2. ![alt](attachments/foo.png)      —— export 出去的 portable 形态
//  3. ![alt](path/to/foo.png "title")  —— Obsidian / 标准 markdown
//  4. ![[foo.png]]                     —— Obsidian crosslink-embed
//
// 1 是已 ingest 的；2/3/4 是 vault 里 owner 编辑过的 raw 引用，import 时
// 必须找到 vault 里对应的 attachment file → upload MinIO → rewrite 成 1。
//
// resolve 规则跟 Obsidian 对齐：basename 优先（vault 内任何子目录都行），
// 不强 match 完整 relative path。

package obsidian

import (
	"path"
	"regexp"
	"strings"
)

// stdImageRefRegex —— ![alt](URL "optional title") 标准 markdown image。
// 捕获 alt + URL + optional title。URL 不含 whitespace。
var stdImageRefRegex = regexp.MustCompile(
	`!\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)`,
)

// embedRefRegex —— Obsidian ![[file.png]] / ![[file.png|alt]] / ![[file.png|100x100]]。
// 捕获 file path（可能含子目录，但 Obsidian 实际按 basename 找）+ 可选 alt。
var embedRefRegex = regexp.MustCompile(
	`!\[\[([^\]|]+)(?:\|([^\]]*))?\]\]`,
)

// internalAssetURIPrefix —— 我们自家 URI 前缀。出现这个的 ref 已经是 ingested，
// 不需要再 rewrite。
const internalAssetURIPrefix = "standmeet-asset:"

// stdImageRefSubmatchURL / stdImageRefSubmatchAlt —— regexp 子匹配 index。
// FindAllStringSubmatchIndex 返 4 = (start, end) of group 2 (url)。
const (
	imgRefMatchAltStart = 2
	imgRefMatchAltEnd   = 3
	imgRefMatchURLStart = 4
	imgRefMatchURLEnd   = 5
	embedMatchAltStart  = 4
	embedMatchAltEnd    = 5
)

// ImageRef —— body_md 里抽出的一条 image 引用。Original 是要在 body 里替换
// 的原文（完整 markdown 片段）；Basename 是要在 vault 里找的文件名。
type ImageRef struct {
	Original string
	Basename string
	Alt      string
}

// ExtractImageRefs —— 从 body_md 抽所有非 standmeet-asset 的 image 引用。
// 已经是 internal URI 的 (standmeet-asset:...) 跳过 —— 那是 ingested 状态。
func ExtractImageRefs(body string) []ImageRef {
	out := make([]ImageRef, 0)
	out = appendStdImageRefs(out, body)
	out = appendEmbedRefs(out, body)
	return out
}

func appendStdImageRefs(out []ImageRef, body string) []ImageRef {
	for _, m := range stdImageRefRegex.FindAllStringSubmatchIndex(body, -1) {
		full := body[m[0]:m[1]]
		alt := body[m[imgRefMatchAltStart]:m[imgRefMatchAltEnd]]
		url := body[m[imgRefMatchURLStart]:m[imgRefMatchURLEnd]]
		if strings.HasPrefix(url, internalAssetURIPrefix) {
			continue
		}
		if isExternalURL(url) {
			continue
		}
		out = append(out, ImageRef{
			Original: full, Basename: path.Base(url), Alt: alt,
		})
	}
	return out
}

func appendEmbedRefs(out []ImageRef, body string) []ImageRef {
	for _, m := range embedRefRegex.FindAllStringSubmatchIndex(body, -1) {
		full := body[m[0]:m[1]]
		ref := body[m[imgRefMatchAltStart]:m[imgRefMatchAltEnd]]
		alt := ""
		if m[embedMatchAltStart] >= 0 {
			alt = body[m[embedMatchAltStart]:m[embedMatchAltEnd]]
		}
		out = append(out, ImageRef{
			Original: full, Basename: path.Base(ref), Alt: alt,
		})
	}
	return out
}

// isExternalURL —— http(s):// 外链跳过，不当 attachment 处理。
func isExternalURL(u string) bool {
	return strings.HasPrefix(u, "http://") || strings.HasPrefix(u, "https://")
}

// RewriteToInternalURI —— 把 body 里某个 image ref 的 Original 整段换成
// 标准 markdown 形态指向 internal URI。
// 调用：rewrite[ref.Original] = `![alt](standmeet-asset:pending-<id>)`
// 再用 strings.ReplaceAll 替进 body。
func RewriteToInternalURI(alt, pendingID string) string {
	return "![" + alt + "](" + internalAssetURIPrefix + pendingID + ")"
}

// RewriteToVaultPath —— export 时用。把 body 里所有 standmeet-asset:<uuid>
// image ref 改成 attachments/<filename> 的标准 markdown 形态。
// caller 提供 uuid → vault-filename 的 map（filename 由 export 选用，通常是
// `<asset-id>.<ext>`，extension 来自 content-type）。
func RewriteToVaultPath(body string, uriToFilename map[string]string) string {
	return stdImageRefRegex.ReplaceAllStringFunc(body, func(match string) string {
		sub := stdImageRefRegex.FindStringSubmatch(match)
		if len(sub) < 3 {
			return match
		}
		alt := sub[1]
		url := sub[2]
		if !strings.HasPrefix(url, internalAssetURIPrefix) {
			return match
		}
		uuid := strings.TrimPrefix(url, internalAssetURIPrefix)
		filename, ok := uriToFilename[uuid]
		if !ok {
			return match
		}
		return "![" + alt + "](attachments/" + filename + ")"
	})
}
