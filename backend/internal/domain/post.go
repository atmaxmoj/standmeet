// post.go —— blog 文章。设计源自 claude.ai/design 的 posts.js + blog.html。
//
// Post 是 corpus entry 的展开版：visitor chat retriever 通过 path
// "posts/<slug>" 可读；private 文章走跟 wiki 同一套 path-glob ACL (InviteCode
// 的 corpus_permissions 匹 post.path)。
//
// BodyMD 是唯一存储形态：GitHub-flavored markdown 原文。owner 在 Tiptap
// 编辑器（前端 round-trip markdown）或 MCP `post_create` 写入；前端 render
// 走 react-markdown + remark-gfm。retriever 索引时通过 StripMarkdown 拿 plain
// text。

package domain

import (
	"errors"
	"time"
)

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
//
// ObsidianSourcePath / ObsidianImportedAt：Obsidian sync 元数据。空值 = 不是
// 从 vault 来的。re-import 时按 source_path 撞行，比 imported_at vs updated_at
// 决定 skip / overwrite（避免覆盖 owner 在 web 后续改动）。
type Post struct {
	PublishedAt        *time.Time
	CoverImageAssetID  *string
	ObsidianImportedAt *time.Time
	CreatedAt          time.Time
	UpdatedAt          time.Time
	ID                 string
	OwnerID            string
	Slug               string
	Title              string
	Excerpt            string
	BodyMD             string
	CoverHeadline      string
	CoverSub           string
	CoverHue           string
	Visibility         string
	Path               string
	LockedBody         string
	ObsidianSourcePath string
	Tags               []string
	CrossRefs          []string
	ReadMinutes        int32
}

// IsPublished —— published_at 非空 = 已发，前端公开 list 才显示。
func (p *Post) IsPublished() bool { return p.PublishedAt != nil }

// ErrPostNotFound —— post id / slug 不存在或不属于该 owner。
var ErrPostNotFound = errors.New("post not found")

// ErrPostSlugTaken —— 同 owner 下 slug 重复 (unique constraint)。
var ErrPostSlugTaken = errors.New("post slug already taken in this owner")
