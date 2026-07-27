// writing.go —— owner 公开发表的"作品"（前身为 Post / blog 文章）。
//
// LSP contract（4 个 Genre 共契约）：
//   - Writing.Title() 非空（owner save 时必填 title）
//   - Writing.IsPublished() 看 published_at 是否非 nil（其它 Genre 永远 true）
//   - 其它 method 按 Document 一般约定
//
// Writing-specific 字段：Slug / Path / Cover / Visibility / Excerpt /
// ReadMinutes / CrossRefs。Obsidian sync 通过 Integrations 通用机制挂上去
// （从前的 ObsidianSourcePath / ObsidianImportedAt 字段现在内部走
// Integration interface，caller 通过 Integrations().Find(connector.IntegrationObsidian)
// 拿）。

package entity

import (
	"errors"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// Writing —— writings 表的值对象。
type Writing struct {
	timestamps   Timestamps
	cover        Cover
	visibility   Visibility
	id           string
	ownerID      string
	slug         string
	path         string
	excerpt      string
	parentID     string
	content      Content
	integrations connector.Integrations
	crossRefs    []string
	readMinutes  int32
	hasParent    bool
}

// WritingInit —— 构造参数 (postgres mapper 用)。Excerpt / ReadMinutes /
// CrossRefs 是 Writing 独有的几个 leaf 字段，留 flat；其它走嵌套 Init。
// fieldalignment: 嵌入 Init 大字段先，slice，string，int 末。
type WritingInit struct {
	Timestamps   TimestampsInit
	Cover        CoverInit
	Visibility   VisibilityInit
	Path         string
	ID           string
	OwnerID      string
	Slug         string
	Title        string
	Excerpt      string
	Body         string
	ParentID     string
	Tags         []string
	CrossRefs    []string
	Integrations connector.Integrations
	ReadMinutes  int32
}

// NewWriting —— 从 Init 构造。CrossRefs defensive clone。各 sub-object 自己
// 内部 normalize / defensive copy。pointer 入参避开 hugeParam。
func NewWriting(i *WritingInit) Writing {
	refs := []string{}
	if len(i.CrossRefs) > 0 {
		refs = slices.Clone(i.CrossRefs)
	}
	return Writing{
		id:           i.ID,
		ownerID:      i.OwnerID,
		slug:         i.Slug,
		path:         i.Path,
		excerpt:      i.Excerpt,
		parentID:     i.ParentID,
		hasParent:    i.ParentID != "",
		readMinutes:  i.ReadMinutes,
		crossRefs:    refs,
		content:      NewContent(&ContentInit{Title: i.Title, Body: i.Body, Tags: i.Tags}),
		cover:        NewCover(&i.Cover),
		visibility:   NewVisibility(&i.Visibility),
		timestamps:   NewTimestamps(&i.Timestamps),
		integrations: i.Integrations,
	}
}

// --- Document interface (flat 转发) ---

// URI —— writing://<slug>。
func (w *Writing) URI() string { return FormatURI(GenreWriting, w.slug) }

// Genre —— 永远返 GenreWriting。
func (*Writing) Genre() DocumentGenre { return GenreWriting }

// ID —— DB primary key。
func (w *Writing) ID() string { return w.id }

// OwnerID —— owner-scoped corpus FK。
func (w *Writing) OwnerID() string { return w.ownerID }

// Title —— writing 标题。
func (w *Writing) Title() string { return w.content.Title() }

// Body —— writing markdown 主体。
func (w *Writing) Body() string { return w.content.Body() }

// Tags —— 标签列表 (defensive copy)。
func (w *Writing) Tags() []string { return w.content.Tags() }

// CreatedAt —— 创建时间。
func (w *Writing) CreatedAt() time.Time { return w.timestamps.CreatedAt() }

// UpdatedAt —— 最后更新时间。
func (w *Writing) UpdatedAt() time.Time { return w.timestamps.UpdatedAt() }

// Integrations —— 挂的 integration 列表 (defensive copy)，例如 Obsidian sync。
func (w *Writing) Integrations() []connector.Integration { return w.integrations.All() }

// --- Writing-specific accessors ---

// Slug —— URL-friendly 标识，per-owner unique。
func (w *Writing) Slug() string { return w.slug }

// Path —— retriever URI 用的 path (例 "writings/my-slug")。SaveWriting
// 时 postgres mapper 拼好塞进 Init。
func (w *Writing) Path() string { return w.path }

// ParentID —— 树父节点 id + 是否有父(root → "", false)。reader sidebar 嵌套
// + cycle 校验用。跟 Wiki.ParentID 同形。
func (w *Writing) ParentID() (string, bool) { return w.parentID, w.hasParent }

// Excerpt —— 短摘要 / chat answer summary / index 卡片副标题。
func (w *Writing) Excerpt() string { return w.excerpt }

// ReadMinutes —— 阅读时长估算 (StripMarkdown 算 word 除以 225 wpm)。
func (w *Writing) ReadMinutes() int32 { return w.readMinutes }

// CrossRefs —— 关联文章 slug 列表 (Writing-side relations)，defensive copy。
func (w *Writing) CrossRefs() []string {
	return slices.Clone(w.crossRefs)
}

// Cover —— 封面 sub-object (4 字段) 整体返。
func (w *Writing) Cover() Cover { return w.cover }

// Visibility —— 可见性 sub-object 整体返。
func (w *Writing) Visibility() Visibility { return w.visibility }

// PublishedAt —— 发布时间 (time, ok)。未发布 ok=false。
func (w *Writing) PublishedAt() (time.Time, bool) {
	return w.timestamps.PublishedAt()
}

// IsPublished —— 是否已发布。
func (w *Writing) IsPublished() bool { return w.timestamps.IsPublished() }

// Obsidian —— writing 是否从 Obsidian vault sync 来的；type-assert helper
// 让 caller 不用每次 Find + assert。返 (Obsidian{}, false) 表示非 vault。
func (w *Writing) Obsidian() (connector.Obsidian, bool) {
	in, ok := w.integrations.Find(connector.IntegrationObsidian)
	if !ok {
		return connector.Obsidian{}, false
	}
	ob, ok := in.(connector.Obsidian)
	return ob, ok
}

// HasObsidian —— Obsidian() 的 ok-only 版本。
func (w *Writing) HasObsidian() bool { return w.integrations.Has(connector.IntegrationObsidian) }

// CoverHeadline —— 封面 headline，convenience 让 mapper / view 不用先取
// Cover() 再取字段。
func (w *Writing) CoverHeadline() string { return w.cover.Headline() }

// CoverHue —— 封面色调。
func (w *Writing) CoverHue() string { return w.cover.Hue() }

// CoverImageAssetID —— 封面图 asset id (空字符串表示没传)。
func (w *Writing) CoverImageAssetID() string { return w.cover.ImageAssetID() }

// VisibilityMode —— Visibility().Mode() convenience。
func (w *Writing) VisibilityMode() string { return w.visibility.Mode() }

// LockedBody —— Visibility().LockedBody() convenience。
func (w *Writing) LockedBody() string { return w.visibility.LockedBody() }

// IsPrivate —— Visibility().IsPrivate() convenience。
func (w *Writing) IsPrivate() bool { return w.visibility.IsPrivate() }

// --- Constants (re-exported 给 caller，跟 sub-object 内常量保持唯一来源) ---

// WritingVisibilityPublic / WritingVisibilityPrivate —— 兼容现有 caller
// 习惯的常量名。底层一律走 VisibilityPublic / VisibilityPrivate (visibility.go)。
const (
	WritingVisibilityPublic  = VisibilityPublic
	WritingVisibilityPrivate = VisibilityPrivate
)

// WritingCoverHueAmber / Violet / Acid —— 同样的兼容常量。
const (
	WritingCoverHueAmber  = CoverHueAmber
	WritingCoverHueViolet = CoverHueViolet
	WritingCoverHueAcid   = CoverHueAcid
)

// ErrWritingNotFound —— writing id / slug 不存在或不属于该 owner。
var ErrWritingNotFound = errors.New("writing not found")

// ErrWritingSlugTaken —— 同 owner 下 slug 重复 (unique constraint)。
var ErrWritingSlugTaken = errors.New("writing slug already taken in this owner")
