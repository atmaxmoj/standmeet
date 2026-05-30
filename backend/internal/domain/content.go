// content.go —— Wiki / Output / Writing 共用的"内容"sub-object: title + body
// + tags。
//
// LSP contract：
//   - Title 跨 Genre 同语义 "human-readable label"，可为空字符串（Raw 没标题
//     字段时跳过这层用空，但 Raw 不通过 Content sub-object，直接处理 body
//     这部分 —— Raw 形态本来就没标题概念）。
//   - Body 跨 Genre 同语义 "the document's primary text content"。Writing 内
//     是 markdown 原文，Wiki/Output 是 plain text body。
//   - Tags 永远返非 nil slice (defensive copy)。

package domain

import "slices"

// Content —— corpus document 的内容部分。
type Content struct {
	title, body string
	tags        []string
}

// ContentInit —— 构造参数。
type ContentInit struct {
	Title, Body string
	Tags        []string
}

// NewContent —— 构造 Content；Tags defensive clone 进内部存储。
// 保持 tags 内部永远非 nil 不变性。pointer 入参跟主 NewX 一致。
func NewContent(i *ContentInit) Content {
	tags := []string{}
	if len(i.Tags) > 0 {
		tags = slices.Clone(i.Tags)
	}
	return Content{title: i.Title, body: i.Body, tags: tags}
}

// Title —— 文档标题。Raw 用 "" 实现。
func (c Content) Title() string { return c.title }

// Body —— 文档主体文本。Wiki / Output / Writing 各自的"原文"。
func (c Content) Body() string { return c.body }

// Tags —— 标签列表。永远返非 nil slice (空也返 []string{})。
// defensive copy 避免 caller mutate 影响内部状态。
func (c Content) Tags() []string {
	return slices.Clone(c.tags)
}

// HasTag —— 是否含某 tag。caller filter 用，避免 range + 自己比较。
func (c Content) HasTag(tag string) bool {
	return slices.Contains(c.tags, tag)
}
