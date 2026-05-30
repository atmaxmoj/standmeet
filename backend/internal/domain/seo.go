// seo.go —— Wiki / Output 公开 landing 的 SEO sub-object。
//
// Wiki/Output 可被前端 /wiki/<path> 或 /output/<path> 公开 landing。设
// SEOIndexed=true 才进 sitemap.xml + robots index；SEODescription 拼 og:
// description / meta description / chat answer summary。Writing 不用这个
// sub-object（Writing 自己有 Excerpt 字段干同样的事）。
//
// 注意：这跟 owner-level [[seo-settings]] 全局 SEO 设置不是一个东西。这里
// 是 per-document 级别。

package domain

// SEO —— per-document SEO 字段集 (Wiki + Output 用)。
type SEO struct {
	description string
	indexed     bool
}

// SEOInit —— 构造参数。
type SEOInit struct {
	Description string
	Indexed     bool
}

// NewSEO —— 从 Init 构造。
func NewSEO(i *SEOInit) SEO {
	return SEO{description: i.Description, indexed: i.Indexed}
}

// Description —— meta description / og description / chat answer summary
// 共用文本。空字符串 = 用 fallback (例如 body 截头)。
func (s SEO) Description() string { return s.description }

// Indexed —— 是否进 sitemap + robots index。
func (s SEO) Indexed() bool { return s.indexed }
