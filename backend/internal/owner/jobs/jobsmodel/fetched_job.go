// fetched_job.go — FetchedJob value object: the snapshot the fetcher pulls for one
// job from a source, carried in the Redis 1d-TTL cache. **Never persisted to the DB**;
// its snapshot only lands in applications.job_snapshot when an application is committed
// (Phase 3).
//
// Parallel to the JobSource aggregate — references it by SourceID but doesn't live
// inside that aggregate (this job's lifecycle is independent of the source's lifecycle;
// the owner can discard a single job without touching the source).

package jobsmodel

import (
	"errors"
	"time"
)

// FetchedJob — an ephemerally fetched job. This is the shape the owner sees when
// asking Claude "what's new today". The json tags are for Redis serialization.
//
// Field order follows govet fieldalignment: time.Time (with its nested ptr) first,
// then the slice (ptr/len/cap), strings last.
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

// ErrJobCacheMiss — cache_id lookup in the pool missed (expired / never existed / discarded).
var ErrJobCacheMiss = errors.New("job cache miss")
