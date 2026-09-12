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
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/atmaxmoj/standmeet/internal/infra/snowflake"
	"github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"
	"github.com/redis/go-redis/v9"
)

const (
	defaultTTL = 24 * time.Hour
	// cacheIDWidth — every cache id is padded to this many base-36 digits, because ids of
	// different lengths do not sort as numbers ("9" > "10" as strings). 13 holds any int64.
	cacheIDWidth = 13
	// cacheIDRadix — base 36's digits are 0-9a-z, which is also their byte order, so a
	// fixed-width base-36 number sorts the same as a string and as a number.
	cacheIDRadix = 36
	// poolNodeID — this instance's snowflake node. One instance, one node.
	poolNodeID = 0
	keyPrefix  = "job:"
	scanCount  = 100 // SCAN COUNT hint; the pool is small, one or two rounds is enough
)

// ErrCacheMiss —— the key isn't in Redis (expired / never existed / discarded).
// Aliases jobsmodel.ErrJobCacheMiss so callers can distinguish it with errors.Is.
var ErrCacheMiss = jobsmodel.ErrJobCacheMiss

// Pool —— a Redis-backed 1d TTL job pool.
type Pool struct {
	rdb *redis.Client
	// ids — the pool's own id source. Time-ordered, so the id of an entry says when it
	// went in; see newCacheID for why the pool has to be able to answer that.
	ids *snowflake.Node
	ttl time.Duration
}

// New builds a Pool. ttl=0 uses the default 24h.
func New(rdb *redis.Client, ttl time.Duration) *Pool {
	if ttl <= 0 {
		ttl = defaultTTL
	}
	// Node 0: one instance is one node, and the snowflake package's own doc says multi-node
	// is a future shape. The only error is an out-of-range node id, so a literal 0 failing
	// means that package changed under this one — a broken build, not a runtime condition.
	node, err := snowflake.New(poolNodeID)
	if err != nil {
		panic("jobs cache: snowflake node " + strconv.Itoa(poolNodeID) + ": " + err.Error())
	}
	return &Pool{rdb: rdb, ids: node, ttl: ttl}
}

// Put —— bulk-inserts a batch of FetchedJob pulled by a fetcher. Each entry
// is assigned a new cache_id. The returned slice matches the input order
// one-to-one (updates the CacheID field in place and echoes it back).
func (p *Pool) Put(
	ctx context.Context, ownerID string, jobs []jobsmodel.FetchedJob,
) ([]jobsmodel.FetchedJob, error) {
	out := make([]jobsmodel.FetchedJob, 0, len(jobs))
	for i := range jobs {
		jobs[i].CacheID = p.newCacheID()
		payload, merr := json.Marshal(jobs[i])
		if merr != nil {
			return nil, fmt.Errorf("marshal job: %w", merr)
		}
		k := key(ownerID, jobs[i].CacheID)
		if serr := p.rdb.Set(ctx, k, payload, p.ttl).Err(); serr != nil {
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
// Enqueue AGE isn't stored separately: the key's remaining TTL already is it
// (TTL is fixed, doesn't slide), so age = p.ttl - remaining. Storing a second
// field would create a second source, and the two would eventually disagree.
//
// Enqueue ORDER is a different fact, and TTL cannot carry it: remaining TTL is
// reported per second, so a whole fetch's worth of entries is one tie. The id
// carries the order instead — one field, minted by the one writer, and the
// order is read back off the thing itself rather than kept beside it.
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
	// Newest first, by the id — which is time-ordered and fixed-width, so this is a TOTAL
	// order over the pool. It used to sort on remaining TTL, and every entry from one fetch
	// has the same TTL to the second: the comparison was all ties, and a stable sort leaves
	// ties in SCAN order. So the same pool came back in a different order on each read, and
	// the two surfaces that dedup it disagreed about which duplicate survived.
	slices.SortStableFunc(out, func(a, b PooledJob) int {
		return cmp.Compare(b.Job.CacheID, a.Job.CacheID)
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

// newCacheID —— a time-ordered id, zero-padded so that **sorting the ids as strings is
// sorting them by when they entered the pool**.
//
// It used to be 12 random bytes, and the pool had no record of its own insertion order at
// all. ListWindow sorted by remaining TTL, which is fixed at 24h and reported per second,
// so every entry written by one fetch tied — and a stable sort leaves ties in Redis SCAN
// order, which the code's own comment calls meaningless. Two reads of one pool therefore
// ordered the same duplicates differently, and cross-source dedup keeps whichever it sees
// first: /admin/listings surfaced the JBA copy of a posting while the MCP receipt for the
// same pool surfaced the Greenhouse copy. Two boards, one pool, and no way to say which
// was wrong.
//
// Order is a fact about the write, so it is carried by what the write already produces.
// Base 36's digits are 0-9a-z, which is also their byte order, so a fixed-width base-36
// snowflake sorts lexically exactly as it sorts numerically — no decoder, no second field
// beside the entry, nothing that can drift out of step with it.
func (p *Pool) newCacheID() string {
	s := strconv.FormatInt(p.ids.Next(), cacheIDRadix)
	if n := cacheIDWidth - len(s); n > 0 {
		s = strings.Repeat("0", n) + s
	}
	return s
}
