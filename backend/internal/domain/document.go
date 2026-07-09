// document.go —— corpus 单元素的统一抽象。raw / wiki / output / writing 各自
// 是 Document 的一种 Genre（不同 partition），通过 URI 寻址。
//
// 设计动机：visitor chat retriever 当前对每种 Genre 写一套对称代码（find /
// match / row 三件套各 N 路），换 Document 之后 retriever 内核迁到
// []Document，多 Genre 收敛到一个 path-dispatch。
//
// **A.2 阶段纯 additive** —— 不删任何现有 type/method，只让 4 个具体 corpus
// 类型实现 Document，旧 callers 继续 work。A.3-IAM 才把 retriever 内核切过来。

package domain

import (
	"errors"
	"time"
)

// ErrSubjectivityNotFound —— 按 id 查 subjectivity 未命中（dialog cited 反查用）。
var ErrSubjectivityNotFound = errors.New("subjectivity entry not found")

// DocumentGenre —— corpus 4 个 partition 的枚举。**Genre** 取名取自 IR/library
// science 标准词，表达"corpus 里平级、不同形态/用途的子集"，跟 layer/stage/
// tier 等暗含层级的词区分。
type DocumentGenre string

// Genre 枚举值 —— 字面同 URI scheme，序列化 / DB 列 / 前端 string 共享，避免
// 多套常量同步。
const (
	GenreRaw     DocumentGenre = "raw"
	GenreWiki    DocumentGenre = "wiki"
	GenreOutput  DocumentGenre = "output"
	GenreWriting DocumentGenre = "writing"
	// GenreSubjectivity —— owner 的私有自我模型 partition。agent retrieves it 来 ground voice,
	// 但默认不 cite（不进 visitor footer）；仅 show_as_source=true 的笔记经 cited_subjectivity_ids
	// 展示。故意不入 AllGenres：Corpus facade 的 4-genre List/Get dispatch 不覆盖 subjectivity。
	GenreSubjectivity DocumentGenre = "subjectivity"
)

// AllGenres —— 调用方需要遍 4 个 genre 时用，避免散落 hardcode 列表。
var AllGenres = []DocumentGenre{
	GenreRaw, GenreWiki, GenreOutput, GenreWriting,
}

// Document —— corpus 单元素的接口。
//
// 4 个具体类型（Raw / Wiki / Output / Writing）实现这个接口（A.2-Encap 已
// 全部满足 method set）。接口方法故意小，只暴露 retriever / ACL / list 真
// 用到的字段；hue / cover / excerpt 这类 Genre-specific 字段不进接口，调用
// 方需要时 type-assert 回具体类型。
type Document interface {
	// ID —— 后台数据库 uuid。messages.cited_*_ids 等持久化关系靠它；
	// retriever / dialog 写消息引用时统一通过 Document.ID()。
	ID() string

	// URI —— `<genre>://<addressable>` 形态，全 corpus 唯一寻址 key。
	URI() string

	// Genre —— 返回所属 partition。equivalent 信息能从 URI 解出来，但接口
	// 方法直接给避免 caller 都 ParseURI 一遍。
	Genre() DocumentGenre

	// OwnerID —— corpus 永远 owner-scoped。multi-tenant freebie。
	OwnerID() string

	// Title —— 显示名。retriever 索引、list 渲染、cross-link resolution 共用。
	// Raw 永远返 ""（contract 边界）。
	Title() string

	// Body —— 正文。retriever read 返这个，bag-of-words 索引基于 StripMarkdown
	// 这个。各 Genre 内部字段名不同（content.body 都是这个 sub-object 提供）。
	Body() string

	// Tags —— retriever match 时也会拿来做 token，list 渲染时显示。永远返非
	// nil slice（defensive copy）。
	Tags() []string

	// CreatedAt / UpdatedAt —— Genre 间统一，list / sort / "近期改过" 类查询用。
	// Raw.UpdatedAt() == Raw.CreatedAt()（contract 边界，Raw immutable post-dump）。
	CreatedAt() time.Time
	UpdatedAt() time.Time

	// Integrations —— document 跟外部系统的同步关系列表（Obsidian / Notion /
	// 等）。永远返非 nil slice。
	Integrations() []Integration
}
