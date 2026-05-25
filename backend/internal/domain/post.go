// post.go —— blog 文章。设计源自 claude.ai/design 的 posts.js + blog.html。
//
// Post 是 corpus entry 的展开版：visitor chat retriever 通过 path
// "posts/<slug>" 可读；private 文章走跟 wiki 同一套 path-glob ACL (InviteCode
// 的 corpus_permissions 匹 post.path)。
//
// body_blocks 是 design 用的渲染单元数组；owner 手写 markdown，server
// 入库前 parse。AI 通过 MCP `post_create` 可直接传 blocks。

package domain

import (
	"errors"
	"time"
)

// PostBlock —— 渲染单元；kind ∈ {p, h, pull}。
// p = 段落、h = h2 标题、pull = 大引文 (左 vermillion border)。
type PostBlock struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

// PostVisibility —— public 默认；private 走 path ACL 默认 deny。
const (
	PostVisibilityPublic  = "public"
	PostVisibilityPrivate = "private"
)

// PostCoverHue —— design 三色 (amber / violet / acid)；其他值前端回退 amber。
const (
	PostCoverHueAmber  = "amber"
	PostCoverHueViolet = "violet"
	PostCoverHueAcid   = "acid"
)

// Post —— posts 表的值对象。
type Post struct {
	PublishedAt       *time.Time
	CoverImageAssetID *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
	ID                string
	OwnerID           string
	Slug              string
	Title             string
	Excerpt           string
	CoverHeadline     string
	CoverSub          string
	CoverHue          string
	Visibility        string
	Path              string
	LockedBody        string
	Body              []PostBlock
	Tags              []string
	CrossRefs         []string
	ReadMinutes       int32
}

// IsPublished —— published_at 非空 = 已发，前端公开 list 才显示。
func (p *Post) IsPublished() bool { return p.PublishedAt != nil }

// ErrPostNotFound —— post id / slug 不存在或不属于该 owner。
var ErrPostNotFound = errors.New("post not found")

// ErrPostSlugTaken —— 同 owner 下 slug 重复 (unique constraint)。
var ErrPostSlugTaken = errors.New("post slug already taken in this owner")
