// job_source.go —— outbound 求职链的 fetch 端：owner 注册的 job source
// + fingerprint dedup + 抓出来的 FetchedJob value。
//
// 配合 docs/design/job-loop.md 读。job 永远 ephemeral（Redis 1d TTL），
// 只有 fingerprint 进 DB 永久去重；commit application 时才 snapshot 进
// applications 表（那块在 Phase 3）。

package domain

import (
	"errors"
	"time"
)

// JobSource —— owner 注册的一条 job source（一家公司在 Greenhouse / 一个
// WWR category / HN 月度帖等）。Kind 决定走哪个 fetcher adapter；Config
// 是 per-kind 形状（{"company":"vercel"} / {"categories":[...]} / 空）。
type JobSource struct {
	CreatedAt     time.Time
	LastFetchedAt *time.Time
	Config        map[string]any
	ID            string
	OwnerID       string
	Kind          string
	Label         string
}

// JobFingerprint —— (source_id, external_id) 见过的就不再返回。external_id
// 是各 source 自带的稳定 ID（greenhouse.id / lever.id / hn.comment_id /
// wwr.guid / remoteok.id 等）。
type JobFingerprint struct {
	FirstSeenAt time.Time
	SourceID    string
	ExternalID  string
}

// FetchedJob —— 从源抓出来的一条 job。**不进 DB**，只放 Redis 1d TTL 池
// （key 由 CacheID 携带）。owner 在 Claude 里"今天有什么新工作"看的就是
// 这个 shape；commit application 时它的 snapshot 才进 applications.job_snapshot。
//
// 字段顺序按 govet fieldalignment：time.Time（含 nested ptr）在前，slice
// （ptr len cap）紧跟，strings 在尾。
type FetchedJob struct {
	PublishedAt time.Time
	Tags        []string
	CacheID     string // 短随机串，MCP 工具引用 job 用这个
	SourceID    string
	SourceKind  string
	ExternalID  string
	Title       string
	Company     string
	Location    string
	URL         string // apply_url，Playwright 去填那个
	BodyText    string // JD 全文 (raw)，agent 自己 reason
}

// CreateJobSourceInput —— usecase 层 register_source 的入参。
type CreateJobSourceInput struct {
	Config  map[string]any
	OwnerID string
	Kind    string
	Label   string
}

// JobSource-scoped sentinels.
var (
	// ErrJobSourceNotFound —— 按 id 反查未命中（owner 不匹配也视同未命中）。
	ErrJobSourceNotFound = errors.New("job source not found")
	// ErrJobSourceKindInvalid —— register_source 传了非法 kind。
	ErrJobSourceKindInvalid = errors.New("job source kind invalid")
	// ErrJobSourceConfigInvalid —— config 形状跟 kind 不匹配（缺 company 等）。
	ErrJobSourceConfigInvalid = errors.New("job source config invalid")
	// ErrJobCacheMiss —— 池子里 cache_id 反查不到（过期或从未存在）。
	ErrJobCacheMiss = errors.New("job cache miss")
)
