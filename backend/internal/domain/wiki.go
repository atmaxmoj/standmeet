// wiki.go —— curated 内容（树状）+ owner 维度全局 SEO 设置。
//
// LSP contract（4 个 Genre 共契约）：
//   - Wiki.Title() 非空（owner 整理 wiki 时必填 title）
//   - Wiki.IsPublished() 永远 true（wiki 没 draft 概念，存在即可见）
//   - 其它 method 按一般约定，Tags / Integrations 永远返非 nil
//
// Wiki-specific 字段：ParentID / Path / ShowAsSource / SEODescription /
// SEOIndexed / SourceRawIDs —— caller type-assert 回 Wiki 用。Path/Parent
// 走 TreeNode sub-object；SEO 走 SEO sub-object。

package domain

import (
	"errors"
	"slices"
	"time"
)

// Wiki —— wiki_entries 行的领域值对象。
//
// ShowAsSource：retriever 内 AI 能 read 拿 body 但 readCollector 不收 —— meta /
// persona 这种"用得到但不该曝光"的 entry 用这个开关。
type Wiki struct {
	timestamps   Timestamps
	tree         TreeNode
	id           string
	ownerID      string
	title        string
	content      Content
	integrations Integrations
	seo          SEO
	sourceRawIDs []string
	showAsSource bool
}

// WikiInit —— 构造参数。
type WikiInit struct {
	UpdatedAt      time.Time
	CreatedAt      time.Time
	ParentID       *string
	Path           *string
	Title          string
	ID             string
	OwnerID        string
	Body           string
	SEODescription string
	SourceRawIDs   []string
	Tags           []string
	Integrations   Integrations
	SEOIndexed     bool
	ShowAsSource   bool
}

// NewWiki —— 从 Init 构造。SourceRawIDs defensive clone。pointer 入参避开 hugeParam。
func NewWiki(i *WikiInit) Wiki {
	srcs := []string{}
	if len(i.SourceRawIDs) > 0 {
		srcs = slices.Clone(i.SourceRawIDs)
	}
	return Wiki{
		id:           i.ID,
		ownerID:      i.OwnerID,
		title:        i.Title,
		showAsSource: i.ShowAsSource,
		sourceRawIDs: srcs,
		content: NewContent(&ContentInit{
			Title: i.Title, Body: i.Body, Tags: i.Tags,
		}),
		timestamps: NewTimestamps(&TimestampsInit{
			CreatedAt: i.CreatedAt, UpdatedAt: i.UpdatedAt,
		}),
		tree: NewTreeNode(&TreeNodeInit{ParentID: i.ParentID, Path: i.Path}),
		seo: NewSEO(&SEOInit{
			Description: i.SEODescription, Indexed: i.SEOIndexed,
		}),
		integrations: i.Integrations,
	}
}

// --- Document interface (flat 转发) ---

// URI —— wiki://<path>；path 没设 → fallback wiki://<id> 让 retriever 仍能寻址。
func (w *Wiki) URI() string {
	if p, ok := w.tree.Path(); ok && p != "" {
		return FormatURI(GenreWiki, p)
	}
	return FormatURI(GenreWiki, w.id)
}

// Genre —— 永远返 GenreWiki。
func (*Wiki) Genre() DocumentGenre { return GenreWiki }

// ID —— DB primary key。
func (w *Wiki) ID() string { return w.id }

// OwnerID —— owner-scoped corpus FK。
func (w *Wiki) OwnerID() string { return w.ownerID }

// Title —— wiki entry 标题。
func (w *Wiki) Title() string { return w.content.Title() }

// Body —— wiki entry 主体文本。
func (w *Wiki) Body() string { return w.content.Body() }

// Tags —— 标签列表 (defensive copy)。
func (w *Wiki) Tags() []string { return w.content.Tags() }

// CreatedAt —— 创建时间。
func (w *Wiki) CreatedAt() time.Time { return w.timestamps.CreatedAt() }

// UpdatedAt —— 最后更新时间。
func (w *Wiki) UpdatedAt() time.Time { return w.timestamps.UpdatedAt() }

// Integrations —— 挂的 integration 列表 (defensive copy)。
func (w *Wiki) Integrations() []Integration { return w.integrations.All() }

// --- Wiki-specific accessors ---

// ParentID —— 父 wiki id 或 ("", false) 表示 root。
func (w *Wiki) ParentID() (string, bool) { return w.tree.ParentID() }

// Path —— owner 配的公开 path 或 ("", false)。
func (w *Wiki) Path() (string, bool) { return w.tree.Path() }

// PathOrEmpty —— Path 的"或空串"形态。retriever 不区分 nil 跟 "" 时用。
func (w *Wiki) PathOrEmpty() string { return w.tree.PathOrEmpty() }

// HasPath —— 是否设了 path。
func (w *Wiki) HasPath() bool { return w.tree.HasPath() }

// ShowAsSource —— 是否进 readCollector 的 cited 列表（默认 true；persona
// 类条目设 false）。
func (w *Wiki) ShowAsSource() bool { return w.showAsSource }

// SEODescription —— SEO meta description。
func (w *Wiki) SEODescription() string { return w.seo.Description() }

// SEOIndexed —— 是否进 sitemap + robots index。
func (w *Wiki) SEOIndexed() bool { return w.seo.Indexed() }

// SourceRawIDs —— 该 wiki 是从哪些 raw promote 来的（defensive copy）。
func (w *Wiki) SourceRawIDs() []string {
	return slices.Clone(w.sourceRawIDs)
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

// ErrPathTaken —— wiki/output 的 path 已被同 owner 别的 entry 占用
// (unique-per-owner constraint)。
var ErrPathTaken = errors.New("path already taken in this owner")

// ErrWikiNotFound —— 按 id 查 wiki 未命中。
var ErrWikiNotFound = errors.New("wiki entry not found")
