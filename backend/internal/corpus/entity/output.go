// output.go —— 最精炼层。raw → wiki → output。output 跟 wiki 同构（树状 +
// SEO 字段），语义差别是"可以在对话里完整原样引用的成品"。
//
// LSP contract（4 个 Genre 共契约）：
//   - Output.Title() 非空
//   - Output.IsPublished() 永远 true（同 wiki，存在即可见）
//   - 其它 method 按 Document 一般约定
//
// Output-specific 字段：ParentID / Path / ShowAsSource / Excerpt /
// Published / SourceWikiIDs —— Output 跟 Wiki 唯一形式差别是
// SourceWikiIDs vs SourceRawIDs，其它对称。

package entity

import (
	"errors"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/connector"
)

// Output —— corpus_notes(genre=output) 行的领域值对象。结构跟 Wiki 严格对齐，差别只在
// SourceWikiIDs vs SourceRawIDs（语义清晰）。retrieval ACL + landing 复用
// Path / ShowAsSource 同一组字段——同 wiki。
type Output struct {
	timestamps    Timestamps
	tree          TreeNode
	id            string
	ownerID       string
	title         string
	content       Content
	integrations  connector.Integrations
	excerpt       string
	sourceWikiIDs []string
	showAsSource  bool
	published     bool
}

// OutputInit —— 构造参数。
type OutputInit struct {
	UpdatedAt     time.Time
	CreatedAt     time.Time
	ParentID      *string
	Title         string
	ID            string
	OwnerID       string
	Body          string
	Excerpt       string
	SourceWikiIDs []string
	Tags          []string
	Integrations  connector.Integrations
	Published     bool
	ShowAsSource  bool
}

// NewOutput —— 从 Init 构造。pointer 入参避开 hugeParam。
func NewOutput(i *OutputInit) Output {
	srcs := []string{}
	if len(i.SourceWikiIDs) > 0 {
		srcs = slices.Clone(i.SourceWikiIDs)
	}
	return Output{
		id:            i.ID,
		ownerID:       i.OwnerID,
		title:         i.Title,
		showAsSource:  i.ShowAsSource,
		sourceWikiIDs: srcs,
		content: NewContent(&ContentInit{
			Title: i.Title, Body: i.Body, Tags: i.Tags,
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

// URI —— output://<id>。地址树派生、随集合而变,cite/寻址按稳定的 id。
func (o *Output) URI() string {
	return FormatURI(GenreOutput, o.id)
}

// Genre —— 永远返 GenreOutput。
func (*Output) Genre() DocumentGenre { return GenreOutput }

// ID —— DB primary key。
func (o *Output) ID() string { return o.id }

// OwnerID —— owner-scoped corpus FK。
func (o *Output) OwnerID() string { return o.ownerID }

// Title —— output entry 标题。
func (o *Output) Title() string { return o.content.Title() }

// Body —— output entry 主体文本。
func (o *Output) Body() string { return o.content.Body() }

// Tags —— 标签列表 (defensive copy)。
func (o *Output) Tags() []string { return o.content.Tags() }

// CreatedAt —— 创建时间。
func (o *Output) CreatedAt() time.Time { return o.timestamps.CreatedAt() }

// UpdatedAt —— 最后更新时间。
func (o *Output) UpdatedAt() time.Time { return o.timestamps.UpdatedAt() }

// Integrations —— 挂的 integration 列表 (defensive copy)。
func (o *Output) Integrations() []connector.Integration { return o.integrations.All() }

// --- Output-specific accessors ---

// ParentID —— 父 output id 或 ("", false) 表示 root。地址树派生(见 wiki)。
func (o *Output) ParentID() (string, bool) { return o.tree.ParentID() }

// ShowAsSource —— 是否进 readCollector cited 列表。
func (o *Output) ShowAsSource() bool { return o.showAsSource }

// Excerpt —— 一句话摘要（卡片 excerpt / og:description / cited summary 共用）。
func (o *Output) Excerpt() string { return o.excerpt }

// Published —— 是否公开（进 sitemap + robots index + 访客可读）。
func (o *Output) Published() bool { return o.published }

// SourceWikiIDs —— 该 output 是从哪些 wiki 提炼来的 (defensive copy)。
func (o *Output) SourceWikiIDs() []string {
	return slices.Clone(o.sourceWikiIDs)
}

// ErrOutputNotFound —— 按 id 查 output 未命中。
var ErrOutputNotFound = errors.New("output entry not found")
