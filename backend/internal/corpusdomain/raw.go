// raw.go —— owner 通过 MCP 推上来的"半成品" corpus 条目（curate 前）。
//
// LSP contract（4 个 Genre 共契约）：
//   - Raw.Title() 永远 "" (Raw 形态本身无标题概念)
//   - Raw.UpdatedAt() == Raw.CreatedAt() (Raw immutable post-dump，无独立 update
//     时间)
//   - Raw.IsPublished() 永远 false (Raw 没有 publish 概念)
//   - Raw.Integrations() 现在返空 slice，但 schema 支持未来从 clipboard /
//     IM bridge 同步进 Raw 后挂 integration 而不动接口
//
// Raw-specific 字段（不进 Document interface）：Source / FlaggedPrivate /
// Archived / PromotedTo —— caller type-assert 回 Raw 用。

package corpusdomain

import (
	"errors"
	"time"

	"github.com/atmaxmoj/standmeet/internal/domain"
)

// Raw —— owner 通过 MCP push 进 corpus 的"半成品"，未整理。
type Raw struct {
	timestamps     domain.Timestamps
	promotedTo     *string
	parentID       *string
	id             string
	ownerID        string
	source         string
	content        Content
	integrations   domain.Integrations
	flaggedPrivate bool
	archived       bool
}

// RawInit —— 构造参数 (postgres mapper 用)。
type RawInit struct {
	CreatedAt      time.Time
	PromotedTo     *string
	ParentID       *string
	ID             string
	OwnerID        string
	Title          string
	Body           string
	Source         string
	Tags           []string
	Integrations   domain.Integrations
	FlaggedPrivate bool
	Archived       bool
}

// NewRaw —— 从 Init 构造。PromotedTo defensive copy。Timestamps 自动把
// CreatedAt 同时塞给 updatedAt（Raw 不变 LSP）。pointer 入参避免 hugeParam。
func NewRaw(i *RawInit) Raw {
	var promotedTo *string
	if i.PromotedTo != nil {
		v := *i.PromotedTo
		promotedTo = &v
	}
	var parentID *string
	if i.ParentID != nil {
		v := *i.ParentID
		parentID = &v
	}
	return Raw{
		id:             i.ID,
		ownerID:        i.OwnerID,
		source:         i.Source,
		flaggedPrivate: i.FlaggedPrivate,
		archived:       i.Archived,
		promotedTo:     promotedTo,
		parentID:       parentID,
		content: NewContent(&ContentInit{
			Title: i.Title, Body: i.Body, Tags: i.Tags,
		}),
		timestamps: domain.NewTimestamps(&domain.TimestampsInit{
			CreatedAt: i.CreatedAt, UpdatedAt: i.CreatedAt,
		}),
		integrations: i.Integrations,
	}
}

// --- Document interface implementation (flat 转发) ---

// URI —— raw://<uuid>。
func (r *Raw) URI() string { return FormatURI(GenreRaw, r.id) }

// Genre —— 永远返 GenreRaw。
func (*Raw) Genre() DocumentGenre { return GenreRaw }

// ID —— DB primary key。
func (r *Raw) ID() string { return r.id }

// OwnerID —— corpus 永远 owner-scoped。
func (r *Raw) OwnerID() string { return r.ownerID }

// Title —— Raw 无标题，永远 ""。
func (r *Raw) Title() string { return r.content.Title() }

// Body —— dump 进来的原文。
func (r *Raw) Body() string { return r.content.Body() }

// Tags —— 标签 (defensive copy)，永远非 nil。
func (r *Raw) Tags() []string { return r.content.Tags() }

// CreatedAt —— dump 时间。
func (r *Raw) CreatedAt() time.Time { return r.timestamps.CreatedAt() }

// UpdatedAt —— 同 CreatedAt (Raw 不变 LSP contract)。
func (r *Raw) UpdatedAt() time.Time { return r.timestamps.UpdatedAt() }

// Integrations —— 挂的 integration 副本（defensive copy），永远非 nil。
func (r *Raw) Integrations() []domain.Integration { return r.integrations.All() }

// --- Raw-specific accessors ---

// Source —— ingest source 标签 (e.g. "claude-desktop" / "clipboard" / "mcp")。
func (r *Raw) Source() string { return r.source }

// ParentID —— tree parent (raw is now a corpus_notes node); ok=false at the root. Mirrors Wiki.
func (r *Raw) ParentID() (string, bool) {
	if r.parentID == nil {
		return "", false
	}
	return *r.parentID, true
}

// FlaggedPrivate —— owner 标记"私密"的 dump。retriever 跳过这种。
func (r *Raw) FlaggedPrivate() bool { return r.flaggedPrivate }

// Archived —— owner 归档的 dump，不进 retriever 候选。
func (r *Raw) Archived() bool { return r.archived }

// PromotedTo —— 如果 raw 被 promote 成 wiki/output，返目标 id；否则
// ("", false)。
func (r *Raw) PromotedTo() (string, bool) {
	if r.promotedTo == nil {
		return "", false
	}
	return *r.promotedTo, true
}

// IsPromoted —— 是否被 promote 过。语义版 PromotedTo() ok。
func (r *Raw) IsPromoted() bool { return r.promotedTo != nil }

// ErrRawNotFound —— 按 id 查 raw 未命中。
var ErrRawNotFound = errors.New("raw entry not found")
