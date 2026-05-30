// writing.go —— owner 公开发表的"作品"（前身为 Post / blog 文章）。
//
// Writing 是 corpus document 的展开版：visitor chat retriever 通过 URI
// `writing://<slug>` 可读；private writing 走跟 wiki 同一套 URI-glob ACL
// (InviteCode 的 corpus_permissions 匹 writing 的 URI)。
//
// BodyMD 是唯一存储形态：GitHub-flavored markdown 原文。owner 在 Tiptap
// 编辑器（前端 round-trip markdown）或 MCP `writing_create` 写入；前端
// render 走 react-markdown + remark-gfm。retriever 索引时通过 StripMarkdown
// 拿 plain text。

package domain

import (
	"errors"
	"time"
)

// WritingVisibility —— public 默认；private 走 URI ACL 默认 deny。
const (
	WritingVisibilityPublic  = "public"
	WritingVisibilityPrivate = "private"
)

// WritingCoverHue —— design 三色 (amber / violet / acid)；其他值前端回退 amber。
const (
	WritingCoverHueAmber  = "amber"
	WritingCoverHueViolet = "violet"
	WritingCoverHueAcid   = "acid"
)

// Writing —— writings 表的值对象。
//
// ObsidianSourcePath / ObsidianImportedAt：Obsidian sync 元数据。空值 = 不是
// 从 vault 来的。re-import 时按 source_path 撞行，比 imported_at vs updated_at
// 决定 skip / overwrite（避免覆盖 owner 在 web 后续改动）。
type Writing struct {
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
func (w *Writing) IsPublished() bool { return w.PublishedAt != nil }

// ErrWritingNotFound —— writing id / slug 不存在或不属于该 owner。
var ErrWritingNotFound = errors.New("writing not found")

// ErrWritingSlugTaken —— 同 owner 下 slug 重复 (unique constraint)。
var ErrWritingSlugTaken = errors.New("writing slug already taken in this owner")
