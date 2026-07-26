// job_source.go —— JobSource aggregate: owner 注册的 job source（root）+
// JobFingerprint（child entity，dedup 用）+ 创建入参 DTO + source-scoped
// sentinels。
//
// FetchedJob 是 fetcher 跑出来的 value object（Redis 1d TTL，不持久），
// 见 fetched_job.go。它 references JobSource by ID 但不在这个 aggregate。
//
// 配合 docs/design/job-loop.md 读。

package jobsmodel

import (
	"errors"
	"time"
)

// JobSource —— aggregate root。Kind 决定 fetcher adapter；Config 是
// per-kind 形状的 raw JSON bytes（{"company":"vercel"} / {"categories":
// [...]} / 空对象），各 adapter 自己 unmarshal 到 typed struct，让 domain
// 不沾 schemaless `any`。
type JobSource struct {
	CreatedAt     time.Time
	LastFetchedAt *time.Time
	ID            string
	OwnerID       string
	Kind          string
	Label         string
	Config        []byte
}

// JobFingerprint —— JobSource aggregate 内的 child entity。
// (source_id, external_id) 见过就不再返回；CASCADE 跟 source 一起删。
type JobFingerprint struct {
	FirstSeenAt time.Time
	SourceID    string
	ExternalID  string
}

// CreateJobSourceInput —— usecase 层 register_source 的入参。
// Config 是 raw JSON bytes（同 JobSource.Config 形状）。
type CreateJobSourceInput struct {
	OwnerID string
	Kind    string
	Label   string
	Config  []byte
}

// JobSource-scoped sentinels.
var (
	// ErrJobSourceNotFound —— 按 id 反查未命中（owner 不匹配也视同未命中）。
	ErrJobSourceNotFound = errors.New("job source not found")
	// ErrJobSourceKindInvalid —— register_source 传了非法 kind。
	ErrJobSourceKindInvalid = errors.New("job source kind invalid")
	// ErrJobSourceConfigInvalid —— config JSON shape 跟 kind 不匹配
	// （缺 company / categories 等必填字段）。
	ErrJobSourceConfigInvalid = errors.New("job source config invalid")
)
