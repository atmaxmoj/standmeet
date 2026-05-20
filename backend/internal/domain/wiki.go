// wiki.go —— curated 内容（树状）+ owner 维度全局 SEO 设置。

package domain

import (
	"errors"
	"time"
)

// WikiEntry —— curated 内容，树状组织（parent_id 形成森林，root = ParentID==nil）。
// Path 是 induced —— 从 ParentID 链 walk 出来，repo 提供 ComputePath() 算。
// SEO 字段：seo_slug 启用 /<handle>/wiki/<slug> landing；
// seo_indexed=true 才会进 sitemap.xml。
type WikiEntry struct {
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
	SourceRawIDs   []string
	SEOIndexed     bool
}

// SEOSettings —— owner 维度全局 SEO 设置。
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr at 16），strings
// 中间（ptr at 0），slice 在尾（ptr at 0），bool 末尾占 tail padding。
type SEOSettings struct {
	UpdatedAt     time.Time
	OwnerID       string
	OGTemplate    string
	SitemapExtras []string
	IndexRobots   bool
}

// ErrSlugTaken —— wiki 的 seo_slug 已被同 owner 别的 entry 占用。
var ErrSlugTaken = errors.New("seo slug already taken in this owner")

// ErrWikiNotFound —— 按 id 查 wiki 未命中。
var ErrWikiNotFound = errors.New("wiki entry not found")
