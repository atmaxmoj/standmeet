// page_content.go —— owner public page 完整内容。各 section 留作 typed
// 结构（前端 + admin 编辑都按这个 shape），不让 jsonb 漏到上层。
// 设计稿 J / docs/design/project/page-content.js 是字段语义来源。
//
// 这是 Owner aggregate 的"内容切面" —— 跟 OwnerSettings 平行，跟着 owner_id
// 一起走 repo；不是独立 aggregate root。

package domain

import (
	"errors"
	"time"
)

// PageContent —— owner public page 完整内容。
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr at 16）+ 嵌套
// 结构 + 字符串 + 切片在后，使 last pointer offset 尽量小。
type PageContent struct {
	UpdatedAt    time.Time     `json:"updated_at"`
	Where        PageWhere     `json:"where"`
	Contact      PageContact   `json:"contact"`
	OwnerID      string        `json:"owner_id"`
	HeroProse    string        `json:"hero_prose"`
	HeroExamples []string      `json:"hero_examples"`
	Insights     []PageInsight `json:"insights"`
	Projects     []PageProject `json:"projects"`
}

// PageInsight —— 一条"thesis + 背景 + 展开"的洞见。
type PageInsight struct {
	ID      string `json:"id"`
	Thesis  string `json:"thesis"`
	Context string `json:"context"`
	Body    string `json:"body"`
}

// PageProject —— "typography-only" 风格的项目卡。
type PageProject struct {
	URL     *string  `json:"url,omitempty"`
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Tagline string   `json:"tagline"`
	Lines   []string `json:"lines"`
}

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
