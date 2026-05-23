// wiki.go —— curated 内容（树状）+ owner 维度全局 SEO 设置。

package domain

import (
	"errors"
	"time"
)

// WikiEntry —— curated 内容，树状组织（parent_id 形成森林，root = ParentID==nil）。
// TitlePath 是 induced —— 从 ParentID 链 walk 出来，repo 提供 ComputeTitlePath() 算。
//
// Path（区别于 TitlePath）是显式标识：retrieval ACL 按 path-glob 评估；同时也是
// /<handle>/wiki/<path> 公开 landing 的最后一段（catch-all）。可为 nil。
// ShowAsSource=false：AI 可 read 拿 body，但 readCollector 不收 —— meta/persona
// 这种 "用得到但不该曝光" 的 entry 用这个开关。
type WikiEntry struct {
	CreatedAt      time.Time
	UpdatedAt      time.Time
	ParentID       *string
	Path           *string
	ID             string
	OwnerID        string
	Title          string
	Body           string
	SEODescription string
	Tags           []string
	SourceRawIDs   []string
	ShowAsSource   bool
	SEOIndexed     bool
}

// SEOSettings —— owner 维度全局 SEO 设置。
// 字段顺序按 govet fieldalignment：time.Time 在前（内部 ptr at 16），strings
// 中间（ptr at 0），slice 在尾（ptr at 0），bool 末尾占 tail padding。
type SEOSettings struct {
	UpdatedAt     time.Time
	OwnerID       string
	OGTemplate    string
	SitemapExtras []string
	IndexRobots   bool
}

// ErrPathTaken —— wiki/output 的 path 已被同 owner 别的 entry 占用
// (unique-per-owner constraint)。
var ErrPathTaken = errors.New("path already taken in this owner")

// ErrWikiNotFound —— 按 id 查 wiki 未命中。
var ErrWikiNotFound = errors.New("wiki entry not found")
