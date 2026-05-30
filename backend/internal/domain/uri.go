// uri.go —— corpus document 的 URI 解析 / 拼接。
//
// 形态：`<genre>://<path>`
//   - raw://<uuid>           （raw 没语义路径，UUID 是唯一寻址）
//   - wiki://projects/lucerna
//   - output://essays/principles
//   - writing://my-slug
//
// scheme 严格 = 4 个 DocumentGenre 字面值；其余视为 invalid。`://` 后的 path
// 不做编码（owner 配 path 时不允许 `?` / `#` 等 URL meta，保持纯文件路径
// 形态，跟 Quartz / Obsidian 的 vault path 一致）。
//
// **A.2 阶段不用 net/url** —— 避免它对 host / 端口 / query 的语义介入，纯
// 字符串 split-by-"://" 即可。未来真要更严格的 URI 校验再换。

package domain

import (
	"errors"
	"fmt"
	"slices"
	"strings"
)

// URIRef —— Document URI 解析结果。Path 不带 leading `/`，跟 owner 配的
// Wiki.Path / Writing.Slug 等字段直接对齐。
type URIRef struct {
	Genre DocumentGenre
	Path  string
}

// ErrURIInvalid —— ParseURI 无法识别的 URI 字面。
var ErrURIInvalid = errors.New("invalid corpus URI")

// uriSep —— `://` 是 URI scheme 跟 path 的固定分隔，extract 出来避免 magic
// 字符串散落。
const uriSep = "://"

// ParseURI —— `wiki://projects/lucerna` → URIRef{Genre: GenreWiki, Path:
// "projects/lucerna"}。空 path 算合法（`writing://` 指 writing 集合本身），但
// genre 必须在 4 个枚举里；其它一律 ErrURIInvalid 包错。
func ParseURI(s string) (URIRef, error) {
	idx := strings.Index(s, uriSep)
	if idx <= 0 {
		return URIRef{}, fmt.Errorf("%w: missing scheme: %q", ErrURIInvalid, s)
	}
	genre := DocumentGenre(s[:idx])
	if !isValidGenre(genre) {
		return URIRef{}, fmt.Errorf("%w: unknown genre %q", ErrURIInvalid, genre)
	}
	return URIRef{Genre: genre, Path: s[idx+len(uriSep):]}, nil
}

// FormatURI —— URIRef → `<genre>://<path>`。空 path 输出 `<genre>://`。
// caller 通常用 `Document.URI()` 而不直接调这个，但 admin / migration
// 工具按 Genre + path 拼时直接用。
func FormatURI(genre DocumentGenre, path string) string {
	return string(genre) + uriSep + path
}

// isValidGenre —— DocumentGenre 字面是否在白名单。AllGenres 做 source of
// truth，避免漏一个 case。
func isValidGenre(g DocumentGenre) bool {
	return slices.Contains(AllGenres, g)
}
