// fetched_job.go —— FetchedJob value object：fetcher 从源抓出来一条 job
// 的 snapshot，Redis 1d TTL 缓存的载体。**不进 DB**；commit application
// 时它的 snapshot 才进 applications.job_snapshot（Phase 3）。
//
// 跟 JobSource aggregate 平行 —— references it by SourceID 但不在那个 aggregate
// 里（这条 job 的生命周期独立于 source 的生命周期，owner 可以丢弃单条而不动 source）。

package jobsdomain

import (
	"errors"
	"time"
)

// FetchedJob —— ephemeral 抓出来的 job。owner 在 Claude 里"今天有什么新工作"
// 看的就是这个 shape。json tags 是 Redis 序列化用。
//
// 字段顺序按 govet fieldalignment：time.Time（含 nested ptr）在前，slice
// （ptr len cap）紧跟，strings 在尾。
type FetchedJob struct {
	PublishedAt time.Time `json:"published_at"`
	CacheID     string    `json:"cache_id"`
	SourceID    string    `json:"source_id"`
	SourceKind  string    `json:"source_kind"`
	ExternalID  string    `json:"external_id"`
	Title       string    `json:"title"`
	Company     string    `json:"company"`
	Location    string    `json:"location"`
	URL         string    `json:"url"`
	BodyText    string    `json:"body_text"`
	Tags        []string  `json:"tags"`
}

// ErrJobCacheMiss —— 池子里 cache_id 反查不到（过期 / 从未存在 / discard 过）。
var ErrJobCacheMiss = errors.New("job cache miss")
