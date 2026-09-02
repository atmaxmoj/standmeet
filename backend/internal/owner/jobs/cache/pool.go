// Package cache —— a Redis-backed 1d TTL pool holding FetchedJob entries the
// fetcher pulled but hasn't committed yet. After the owner runs
// `jobs.fetch_new` in Claude, jobs.show / resume.draft look the job back up
// by cache_id.
//
// See docs/design/job-loop.md L.13 for the decision: a draft snapshots the
// job into the draft row at creation time, so eviction from the pool
// doesn't affect a later commit.
//
// Key shape: job:{owner_id}:{cache_id} → FetchedJob JSON, TTL 24h fixed
// (no sliding — the pool is ephemeral; on timeout the owner just re-fetches).
//
// Moves into plugins/jobs/cache/ starting at the J phase, as the jobs
// plugin's cache sub-package.
package cache

import (
	"cmp"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/redis/go-redis/v9"
)

const (
	defaultTTL   = 24 * time.Hour
	cacheIDBytes = 12 // base64url → ~16 chars, enough to avoid collisions
	keyPrefix    = "job:"
	scanCount    = 100 // SCAN COUNT hint; the pool is small, one or two rounds is enough
)

// ErrCacheMiss —— the key isn't in Redis (expired / never existed / discarded).
// Aliases jobsmodel.ErrJobCacheMiss so callers can distinguish it with errors.Is.
var ErrCacheMiss = jobsmodel.ErrJobCacheMiss

// Pool —— a Redis-backed 1d TTL job pool.
type Pool struct {
	rdb *redis.Client
	ttl time.Duration
}

// New builds a Pool. ttl=0 uses the default 24h.
func New(rdb *redis.Client, ttl time.Duration) *Pool {
	if ttl <= 0 {
		ttl = defaultTTL
	}
	return &Pool{rdb: rdb, ttl: ttl}
}

// Put —— bulk-inserts a batch of FetchedJob pulled by a fetcher. Each entry
// is assigned a new cache_id. The returned slice matches the input order
// one-to-one (updates the CacheID field in place and echoes it back).
func (p *Pool) Put(
	ctx context.Context, ownerID string, jobs []jobsmodel.FetchedJob,
) ([]jobsmodel.FetchedJob, error) {
	out := make([]jobsmodel.FetchedJob, 0, len(jobs))
	for i := range jobs {
		id, err := newCacheID()
		if err != nil {
			return nil, fmt.Errorf("gen cache id: %w", err)
		}
		jobs[i].CacheID = id
		payload, merr := json.Marshal(jobs[i])
		if merr != nil {
			return nil, fmt.Errorf("marshal job: %w", merr)
		}
		if serr := p.rdb.Set(ctx, key(ownerID, id), payload, p.ttl).Err(); serr != nil {
			return nil, fmt.Errorf("redis set job: %w", serr)
		}
		out = append(out, jobs[i])
	}
	return out, nil
}

// Get —— single-entry lookup; returns ErrCacheMiss if expired / discarded.
func (p *Pool) Get(
	ctx context.Context, ownerID, cacheID string,
) (jobsmodel.FetchedJob, error) {
	raw, err := p.rdb.Get(ctx, key(ownerID, cacheID)).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return jobsmodel.FetchedJob{}, ErrCacheMiss
		}
		return jobsmodel.FetchedJob{}, fmt.Errorf("redis get job: %w", err)
	}
	var job jobsmodel.FetchedJob
	if uerr := json.Unmarshal(raw, &job); uerr != nil {
		return jobsmodel.FetchedJob{}, fmt.Errorf("decode job: %w", uerr)
	}
	return job, nil
}

// ListByOwner —— every job currently in the owner's pool (live keys; expired
// ones simply don't come back from SCAN). Used by the admin /listings
// read-only view. The pool is ephemeral, order isn't guaranteed. Returns an
// empty slice when there are no jobs.
func (p *Pool) ListByOwner(ctx context.Context, ownerID string) ([]jobsmodel.FetchedJob, error) {
	keys, err := p.scanKeys(ctx, keyPrefix+ownerID+":*")
	if err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return []jobsmodel.FetchedJob{}, nil
	}
	return p.mgetJobs(ctx, keys)
}

// PooledJob —— one pool entry with **how much longer it has to live**
// attached. The design's `jobs.fetch_new` response already specifies
// `ttl_remaining` (see the MCP tool surface in docs/design/job-loop.md);
// the implementation had been missing it.
type PooledJob struct {
	Job          jobsmodel.FetchedJob
	TTLRemaining time.Duration
}

// ListWindow —— every job in the pool whose **enqueue time falls within
// since**, newest first. since<=0 → the whole live pool.
//
// Enqueue time isn't stored separately: the key's remaining TTL already
// is it (TTL is fixed, doesn't slide), so age = p.ttl - remaining. Storing
// a second field would create a second source, and the two would eventually
// disagree.
func (p *Pool) ListWindow(
	ctx context.Context, ownerID string, since time.Duration,
) ([]PooledJob, error) {
	keys, err := p.scanKeys(ctx, keyPrefix+ownerID+":*")
	if err != nil {
		return nil, err
	}
	if len(keys) == 0 {
		return []PooledJob{}, nil
	}
	rows, err := p.getWithTTL(ctx, keys)
	if err != nil {
		return nil, err
	}
	out := p.withinWindow(rows, since)
	// Larger remaining TTL = enqueued more recently. SCAN order carries no
	// meaning, but "newest first" does.
	slices.SortStableFunc(out, func(a, b PooledJob) int {
		return cmp.Compare(b.TTLRemaining, a.TTLRemaining)
	})
	return out, nil
}

// Discard —— actively removes an entry from the pool (the owner decided to
// pass on it). Already-gone counts as success.
func (p *Pool) Discard(ctx context.Context, ownerID, cacheID string) error {
	if derr := p.rdb.Del(ctx, key(ownerID, cacheID)).Err(); derr != nil {
		return fmt.Errorf("redis del job: %w", derr)
	}
	return nil
}

// TTL —— returns the key's remaining TTL; for tests (also handy for admin
// debugging). 0 = missing.
func (p *Pool) TTL(ctx context.Context, ownerID, cacheID string) (time.Duration, error) {
	t, err := p.rdb.TTL(ctx, key(ownerID, cacheID)).Result()
	if err != nil {
		return 0, fmt.Errorf("redis ttl job: %w", err)
	}
	// redis returns -2 for missing key, -1 for no expire
	if t < 0 {
		return 0, nil
	}
	return t, nil
}

// withinWindow —— keeps only entries whose enqueue time falls within since.
// since<=0 → keep everything.
func (p *Pool) withinWindow(rows []PooledJob, since time.Duration) []PooledJob {
	if since <= 0 {
		return rows
	}
	out := make([]PooledJob, 0, len(rows))
	for i := range rows {
		if p.ttl-rows[i].TTLRemaining <= since {
			out = append(out, rows[i])
		}
	}
	return out
}

// getWithTTL —— fetches each key's body and remaining TTL. An entry that
// can't be fetched (expired between scan and exec) is **skipped**, not
// treated as an error: the pool is expected to be expiring things.
func (p *Pool) getWithTTL(ctx context.Context, keys []string) ([]PooledJob, error) {
	cmds, err := p.pipeGetTTL(ctx, keys)
	if err != nil {
		return nil, err
	}
	out := make([]PooledJob, 0, len(keys))
	for i := range keys {
		row, rerr := pooledFrom(cmds.gets[i], cmds.ttls[i])
		if rerr != nil {
			return nil, rerr
		}
		if row.TTLRemaining > 0 {
			out = append(out, row)
		}
	}
	return out, nil
}

// pipeGetTTL —— sends every GET + TTL in a single pipeline round trip.
func (p *Pool) pipeGetTTL(ctx context.Context, keys []string) (pooledCmds, error) {
	pipe := p.rdb.Pipeline()
	c := pooledCmds{
		gets: make([]*redis.StringCmd, len(keys)),
		ttls: make([]*redis.DurationCmd, len(keys)),
	}
	for i, k := range keys {
		c.gets[i] = pipe.Get(ctx, k)
		c.ttls[i] = pipe.TTL(ctx, k)
	}
	// redis.Nil means "some key is gone", not that this call failed as a
	// whole — handled per-entry in pooledFrom.
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return pooledCmds{}, fmt.Errorf("redis pipeline: %w", err)
	}
	return c, nil
}

// pooledCmds —— the paired GET / TTL results from one pipeline call,
// indices aligned with keys.
type pooledCmds struct {
	gets []*redis.StringCmd
	ttls []*redis.DurationCmd
}

// pooledFrom —— turns one (GET, TTL) result pair into a row. **Returns the
// zero value if it can't be fetched** (TTLRemaining==0); the caller uses
// that to skip it: a key expiring between scan and exec is normal, not an
// error. Only a body that fails to decode is a real error — that means bad
// bytes are sitting in the pool.
func pooledFrom(get *redis.StringCmd, ttl *redis.DurationCmd) (PooledJob, error) {
	if !stillPooled(get, ttl) {
		return PooledJob{}, nil
	}
	var job jobsmodel.FetchedJob
	if uerr := json.Unmarshal([]byte(get.Val()), &job); uerr != nil {
		return PooledJob{}, fmt.Errorf("decode job: %w", uerr)
	}
	return PooledJob{Job: job, TTLRemaining: ttl.Val()}, nil
}

// stillPooled —— was this key still alive at exec time. Written as a
// positive check rather than a chain of three `err != nil` early returns:
// "couldn't fetch it" here means **expired**, not a failure in an error chain.
func stillPooled(get *redis.StringCmd, ttl *redis.DurationCmd) bool {
	return get.Err() == nil && ttl.Err() == nil && ttl.Val() > 0
}

func (p *Pool) scanKeys(ctx context.Context, pattern string) ([]string, error) {
	keys := []string{}
	var cursor uint64
	for {
		batch, next, err := p.rdb.Scan(ctx, cursor, pattern, scanCount).Result()
		if err != nil {
			return nil, fmt.Errorf("redis scan: %w", err)
		}
		keys = append(keys, batch...)
		cursor = next
		if cursor == 0 {
			return keys, nil
		}
	}
}

func (p *Pool) mgetJobs(ctx context.Context, keys []string) ([]jobsmodel.FetchedJob, error) {
	vals, err := p.rdb.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("redis mget: %w", err)
	}
	out := make([]jobsmodel.FetchedJob, 0, len(vals))
	for _, v := range vals {
		s, ok := v.(string)
		if !ok {
			continue // key expired between scan and mget
		}
		var job jobsmodel.FetchedJob
		if uerr := json.Unmarshal([]byte(s), &job); uerr != nil {
			return nil, fmt.Errorf("decode job: %w", uerr)
		}
		out = append(out, job)
	}
	return out, nil
}

func key(ownerID, cacheID string) string {
	return keyPrefix + ownerID + ":" + cacheID
}

func newCacheID() (string, error) {
	b := make([]byte, cacheIDBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("rand read: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
