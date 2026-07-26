// page_content.go —— owner public page 完整内容。各 section 留作 typed
// 结构（前端 + admin 编辑都按这个 shape），不让 jsonb 漏到上层。
// 设计稿 J / docs/design/project/page-content.js 是字段语义来源。
//
// 这是 Owner aggregate 的"内容切面" —— 跟 OwnerSettings 平行，跟着 owner_id
// 一起走 repo；不是独立 aggregate root。

package ownerdomain

import (
	"errors"
	"time"
)

// PageContent —— owner public page 完整内容(存储形)。
// insights / projects 不再存内容,存 **pin 列表**(wiki 条目 UUID,数组序即
// 展示序)——想法只存一份,主页是 corpus 的窗口
// (docs/design/page-corpus-pinning.md)。渲染时 join title+excerpt(PagePinCard)。
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr at 16）+ 嵌套
// 结构 + 字符串 + 切片在后，使 last pointer offset 尽量小。
type PageContent struct {
	UpdatedAt    time.Time   `json:"updated_at"`
	Where        PageWhere   `json:"where"`
	Contact      PageContact `json:"contact"`
	OwnerID      string      `json:"owner_id"`
	HeroProse    string      `json:"hero_prose"`
	HeroExamples []string    `json:"hero_examples"`
	Insights     []string    `json:"insights"`
	Projects     []string    `json:"projects"`
}

// PagePinCard —— 一个 pin 渲染出的卡:被 pin 条目的 title + excerpt + 树派生
// path(前端链去 /wiki/<path>)。不变量 pinned ⊆ published 由写入端维护;这里
// 只是 join 结果。
type PagePinCard struct {
	WikiID  string `json:"wiki_id"`
	Title   string `json:"title"`
	Excerpt string `json:"excerpt"`
	Path    string `json:"path"`
}

// ErrPinUnpublished —— pin 一个未 published 的条目;写入点拒绝("publish it
// first"),不变量另一端(unpublish → auto-unpin)在 seo usecase 维护。
var ErrPinUnpublished = errors.New("entry is not published; publish it first")

// ErrPinNotFound —— pin 的 wiki_id 不存在(或不属于该 owner)。
var ErrPinNotFound = errors.New("pinned entry not found")

// PageWhere —— "where I am" section（status + looking-for + closing）。
// 字段顺序按 govet fieldalignment：strings 先，slice 在尾（slice ptr 在 offset 0）。
type PageWhere struct {
	LocationLine string   `json:"location_line"`
	StatusProse  string   `json:"status_prose"`
	Closing      string   `json:"closing"`
	LookingFor   []string `json:"looking_for"`
}

// PageContact —— contact section（email + 多段 prose）。
type PageContact struct {
	Email          string `json:"email"`
	ChatLine       string `json:"chat_line"`
	RecruiterProse string `json:"recruiter_prose"`
	CasualProse    string `json:"casual_prose"`
}

// ErrPageNotFound —— 查 page_content 行不存在；usecase 层返默认值。
var ErrPageNotFound = errors.New("page content not found")
