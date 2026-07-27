// timestamps.go —— corpus document 共用的时间戳 sub-object。
//
// 跨 Genre 共用一个 Timestamps，PublishedAt 是 *time.Time 内部存可空，对
// 没 publish 概念的 Genre (Raw / Wiki / Output 当前) 永远 nil。Raw 还没
// UpdatedAt 字段（一旦 dump 不改），LSP 边界文档化：Raw.UpdatedAt() ==
// Raw.CreatedAt()，在 Raw 包装 Timestamps 时把同样的 time 同时塞 created
// + updated。
//
// 返 PublishedAt 用 (time.Time, bool) 而不是 *time.Time —— 避免 pointer
// 暴露 / 内部状态被 *p = newVal 篡改；caller 写 `if t, ok := x.PublishedAt();
// ok { ... }` 比 `if p := x.PublishedAt(); p != nil { ... }` 更 Go-y。

package entity

import "time"

// Timestamps —— 创建/更新/发布三时间戳的集合。
type Timestamps struct {
	createdAt   time.Time
	updatedAt   time.Time
	publishedAt *time.Time
}

// TimestampsInit —— 构造参数。PublishedAt 可空 (nil 表示未发布)。
type TimestampsInit struct {
	CreatedAt   time.Time
	UpdatedAt   time.Time
	PublishedAt *time.Time
}

// NewTimestamps —— 从 Init 构造 Timestamps；PublishedAt 内部 defensive
// copy（接 caller pointer 时 deref 再重新 alloc 防 *p = newVal 篡改）。
func NewTimestamps(i *TimestampsInit) Timestamps {
	t := Timestamps{
		createdAt: i.CreatedAt,
		updatedAt: i.UpdatedAt,
	}
	if i.PublishedAt != nil {
		cp := *i.PublishedAt
		t.publishedAt = &cp
	}
	return t
}

// CreatedAt —— 创建时间戳。所有 Genre 必填。
func (t Timestamps) CreatedAt() time.Time { return t.createdAt }

// UpdatedAt —— 最后更新时间。Raw 在 NewTimestamps 时被 caller 塞跟
// createdAt 同值 (LSP contract：Raw 不变 = updated == created)。
func (t Timestamps) UpdatedAt() time.Time { return t.updatedAt }

// PublishedAt —— 发布时间，返 (time.Time, bool)；ok=false 表示未发布。
// defensive copy：返值类型而不是内部 *time.Time，caller 拿不到内部指针。
func (t Timestamps) PublishedAt() (time.Time, bool) {
	if t.publishedAt == nil {
		return time.Time{}, false
	}
	return *t.publishedAt, true
}

// IsPublished —— 是否已发布。PublishedAt() 的 boolean-only 版本，frontend
// view 拼 JSON / list filter 用，比每次 (_, ok) 写法读起来好。
func (t Timestamps) IsPublished() bool {
	return t.publishedAt != nil
}
