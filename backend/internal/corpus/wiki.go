// wiki.go —— curated 内容（树状）+ owner 维度全局 SEO 设置。
//
// LSP contract（4 个 Genre 共契约）：
//   - Wiki.Title() 非空（owner 整理 wiki 时必填 title）
//   - Wiki.IsPublished() 永远 true（wiki 没 draft 概念，存在即可见）
//   - 其它 method 按一般约定，Tags / Integrations 永远返非 nil
//
// Wiki-specific 字段：ParentID / Path / ShowAsSource / Excerpt /
// Published / SourceRawIDs —— caller type-assert 回 Wiki 用。Path/Parent
// 走 TreeNode sub-object；SEO 走 SEO sub-object。

package corpus

import (
	"errors"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// Wiki —— corpus_notes(genre=wiki) 行的领域值对象。
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
	integrations domain.Integrations
	excerpt      string
	sourceRawIDs []string
	showAsSource bool
	published    bool
}

// WikiInit —— 构造参数。
type WikiInit struct {
	UpdatedAt    time.Time
	CreatedAt    time.Time
	ParentID     *string
	Title        string
	ID           string
	OwnerID      string
	Body         string
	Excerpt      string
	SourceRawIDs []string
	Tags         []string
	CSSClasses   []string
	Integrations domain.Integrations
	Published    bool
	ShowAsSource bool
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
			Title: i.Title, Body: i.Body, Tags: i.Tags, CSSClasses: i.CSSClasses,
		}),
		timestamps: NewTimestamps(&TimestampsInit{
			CreatedAt: i.CreatedAt, UpdatedAt: i.UpdatedAt,
		}),
		tree:         NewTreeNode(&TreeNodeInit{ParentID: i.ParentID}),
		excerpt:      i.Excerpt,
		published:    i.Published,
		integrations: i.Integrations,
	}
}

// --- Document interface (flat 转发) ---

// URI —— wiki://<id>。地址(树派生 path)是 retrieval 期算的、随集合而变,不是
// entry 自身稳定标识;cite/寻址一律按稳定的 id。
func (w *Wiki) URI() string {
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

// CSSClasses —— per-note cssclasses(呈现钩子)。
func (w *Wiki) CSSClasses() []string { return w.content.CSSClasses() }

// CreatedAt —— 创建时间。
func (w *Wiki) CreatedAt() time.Time { return w.timestamps.CreatedAt() }

// UpdatedAt —— 最后更新时间。
func (w *Wiki) UpdatedAt() time.Time { return w.timestamps.UpdatedAt() }

// Integrations —— 挂的 integration 列表 (defensive copy)。
func (w *Wiki) Integrations() []domain.Integration { return w.integrations.All() }

// --- Wiki-specific accessors ---

// ParentID —— 父 wiki id 或 ("", false) 表示 root。地址是从这条 parent 链
// 树派生算的(usecases.WikiTreePaths),不存 entry 自身。
func (w *Wiki) ParentID() (string, bool) { return w.tree.ParentID() }

// ShowAsSource —— 是否进 readCollector 的 cited 列表（默认 true；persona
// 类条目设 false）。
func (w *Wiki) ShowAsSource() bool { return w.showAsSource }

// Excerpt —— 一句话摘要（卡片 excerpt / og:description / cited summary 共用）。
func (w *Wiki) Excerpt() string { return w.excerpt }

// Published —— 是否公开（进 sitemap + robots index + 访客可读）。
func (w *Wiki) Published() bool { return w.published }

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
	SiteTitle     string
	OGTemplate    string
	SitemapExtras []string
	IndexRobots   bool
}

// ErrWikiNotFound —— 按 id 查 wiki 未命中。
var ErrWikiNotFound = errors.New("wiki entry not found")

// ErrParentNotFound —— 创建/promote 时给的 parent_id 在本 owner 下找不到
// (不存在 / 别的 owner)。地址树派生 + 级联删,不允许挂到无效父上落孤儿。
var ErrParentNotFound = errors.New("parent entry not found")

// ErrParentCycle —— UpdateWiki 改 parent 时,把节点挂到自己或自己的子孙下会成
// 环(地址树派生,环会让 path 计算无意义)。拒绝。
var ErrParentCycle = errors.New("parent would create a cycle")

// ErrSiblingSlugTaken —— 同一 parent(文件夹)下已有一条 title slug 相同的兄弟。
// 地址 = 树派生 slug path,同 slug 兄弟会让 path 不再 1↔1(第二条无法单独寻址)。
// Obsidian 语义:一个文件夹里不能有两个同名文件 —— 写时直接拒,不静默改名/合并。
var ErrSiblingSlugTaken = errors.New("a sibling entry with the same name already exists")
