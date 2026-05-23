// output.go —— 最精炼层。raw → wiki → output。output 跟 wiki 同构
// （树状 + SEO 字段），语义差别是"可以在对话里完整原样引用的成品"。
//
// SourceWikiIDs 记录 output 是从哪些 wiki 提炼来的（promote_wiki_to_output
// 的入参，repo 写库时存进去）。

package domain

import (
	"errors"
	"time"
)

// OutputEntry —— output_entries 行的领域值对象。结构跟 WikiEntry 严格对齐，
// 差别只在 SourceWikiIDs vs SourceRawIDs（语义清晰）。
type OutputEntry struct {
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ParentID       *string
	SEOSlug        *string
	ID             string
	OwnerID        string
	Title          string
	Body           string
	Visibility     string // 'public' | 'on_request' | 'private'
	SEODescription string
	Tags           []string
	SourceWikiIDs  []string
	SEOIndexed     bool
}

// ErrOutputNotFound —— 按 id 查 output 未命中。
var ErrOutputNotFound = errors.New("output entry not found")
