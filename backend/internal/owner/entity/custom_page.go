// custom_page.go —— owner 自定义 React 页面 + sandbox vite build 元数据。

package entity

import (
	"errors"
	"time"
)

// CustomPage —— owner 自定义 React 页面。
type CustomPage struct {
	CreatedAt           time.Time
	UpdatedAt           time.Time
	LiveBuildID         *string
	StagingBuildID      *string
	PreviousLiveBuildID *string
	ID                  string
	OwnerID             string
	Slug                string
	Title               string
	Status              string // 'active' | 'archived' | 'deleted'
	// BoundCodes —— 哪些**活着的**码开这一页（绑定的另一头）。
	// 码→页至多一个，页→码没有这个限制，所以这里是一个数组。
	// 空 = 没有码指向它，只能被匿名打开。
	BoundCodes []string
	// AllowBYOAI —— 没有人出示 grant 时，这一页给不给读者用自己的 key。
	// **来了 code 就作废**：出示的 grant 决定一切（I-4）。
	AllowBYOAI bool
}

// CustomPageBuild —— 一次 sandbox vite build 的状态 + 产物路径。
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr）、pointer、
// strings、map 最后。
type CustomPageBuild struct {
	CreatedAt    time.Time
	BuiltAt      *time.Time
	SourceFiles  map[string]string
	ID           string
	PageID       string
	Status       string // 'pending' | 'building' | 'built' | 'failed'
	OutputPath   string
	ErrorMessage string
}

// ErrCustomPageNotFound —— slug / id 反查不到 custom_page。
var ErrCustomPageNotFound = errors.New("custom page not found")

// ErrCustomPageBuildNotFound —— build_id 反查不到 build。
var ErrCustomPageBuildNotFound = errors.New("custom page build not found")

// ErrCustomPageSlugTaken —— 同 owner 下 slug 已存在 active page。
var ErrCustomPageSlugTaken = errors.New("custom page slug already taken")
