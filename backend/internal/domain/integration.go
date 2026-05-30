// integration.go —— Document 跟外部系统同步关系的统一抽象。
//
// 设计点：
//   - 一个 Document 可以同时挂多个 Integration（同篇 wiki 既被 Obsidian sync
//     又被 Notion 拉，这种未来）。
//   - 加新 integration 类型（Notion/GitHub/AppleNotes/IM bridge…）只需要：
//     新增 IntegrationKind 常量 + 新 struct 实现 Integration interface，不
//     动 Document/Genre/postgres 任何 caller。OCP-correct。
//   - Integrations 管理集合：Add / All / Find / Has，All() 永远 defensive
//     copy 返。

package domain

import (
	"slices"
	"time"
)

// IntegrationKind —— integration 类型枚举。
type IntegrationKind string

// 当前支持的 integration 种类。未来扩展只加常量 + 新 struct 实现接口。
const (
	IntegrationObsidian IntegrationKind = "obsidian"
)

// Integration —— document 跟外部系统的一份同步关系。
type Integration interface {
	// Kind —— 返该 integration 的类型，让 caller 分支处理 / type-assert。
	Kind() IntegrationKind
	// SourceRef —— 外部系统里该 document 的唯一引用（vault path / notion
	// page id / github gist url 等）。
	SourceRef() string
	// LastSyncedAt —— 最近一次同步时间。owner UI 显示用，定期 re-sync 调度
	// 也参考。
	LastSyncedAt() time.Time
}

// Integrations —— document 上挂的所有 integration 管理集合。
// 用值类型 (value type) 嵌进 Document，所有 mutate 操作 (Add) 用指针接收器。
type Integrations struct {
	items []Integration
}

// NewIntegrations —— 构造时直接传一组 integration。空构造 → 空集合。
// items 内部 defensive clone，避免 caller 后续 mutate 影响。
func NewIntegrations(items ...Integration) Integrations {
	out := make([]Integration, 0, len(items))
	out = append(out, items...)
	return Integrations{items: out}
}

// Add —— 加一个 integration。pointer receiver 因为要 mutate。
func (i *Integrations) Add(in Integration) {
	i.items = append(i.items, in)
}

// All —— 返当前所有 integration 的副本，caller 拿到的可以随便 range/sort
// 不会影响内部状态。永远不返 nil（空集合返空 slice）。
func (i *Integrations) All() []Integration {
	out := make([]Integration, len(i.items))
	copy(out, i.items)
	return out
}

// Find —— 按 kind 查回第一条匹中的 integration。caller 通常 type-assert
// 拿回具体类型用 (例如 Obsidian)。没找到返 (nil, false)。
func (i *Integrations) Find(kind IntegrationKind) (Integration, bool) {
	for _, x := range i.items {
		if x.Kind() == kind {
			return x, true
		}
	}
	return nil, false
}

// Has —— 是否挂了该 kind 的 integration。Find 的 boolean-only 版本。
func (i *Integrations) Has(kind IntegrationKind) bool {
	_, ok := i.Find(kind)
	return ok
}

// Len —— integration 数量。caller len(x.All()) 也 work 但要分配；Len 不分配。
func (i *Integrations) Len() int { return len(i.items) }

// Kinds —— 返已挂的所有 IntegrationKind（去重，按出现顺序）。admin UI 渲染用。
func (i *Integrations) Kinds() []IntegrationKind {
	seen := make(map[IntegrationKind]struct{}, len(i.items))
	out := make([]IntegrationKind, 0, len(i.items))
	for _, x := range i.items {
		k := x.Kind()
		if _, dup := seen[k]; dup {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	return out
}

// _ —— compile-time check Integrations 没被错误重命名 / 字段错配。
var _ = slices.Index[[]Integration, Integration]
