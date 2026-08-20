// Package cache —— Redis-backed 1d TTL 池子，放 fetcher 抓出来还没 commit
// 的 FetchedJob。owner 在 Claude 里 `jobs.fetch_new` 后，jobs.show /
// resume.draft 引用 cache_id 找回这条 job。
//
// 见 docs/design/job-loop.md L.13 决策：draft 创建时立刻 snapshot job
// 进 draft 行；池子里 evict 不影响后续 commit。
//
// Key shape: job:{owner_id}:{cache_id} → FetchedJob JSON, TTL 24h fixed
// (不 slide —— 池子是 ephemeral，超时就让 owner 重 fetch)。
//
// J phase 起搬进 plugins/jobs/cache/，作为 jobs plugin 的 cache sub-package。
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
	cacheIDBytes = 12 // base64url → ~16 chars，足够避撞
	keyPrefix    = "job:"
	scanCount    = 100 // SCAN COUNT hint，池子小，一两轮够
)

// ErrCacheMiss —— key 不在 Redis（过期 / 从未存在 / discard 过）。
// 跟 jobsmodel.ErrJobCacheMiss 同义，给 caller 用 errors.Is 区分。
var ErrCacheMiss = jobsmodel.ErrJobCacheMiss

// Pool —— Redis-backed 1d TTL job 池子。
type Pool struct {
	rdb *redis.Client
	ttl time.Duration
}

// New 构造 Pool。ttl=0 时用默认 24h。
func New(rdb *redis.Client, ttl time.Duration) *Pool {
	if ttl <= 0 {
		ttl = defaultTTL
	}
	return &Pool{rdb: rdb, ttl: ttl}
}

// Put —— 批量塞一组 fetcher 抓出来的 FetchedJob。每条 assign 一个新 cache_id。
// 返回的 slice 跟入参顺序一一对应（in-place 更新 cache_id 字段并 echo）。
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

// Get —— 单条反查；过期 / discard 返 ErrCacheMiss。
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

// ListByOwner —— owner 池子里现存的全部 job（live keys；过期的 SCAN 自然不返）。
// admin /listings 只读视图用。池子 ephemeral，顺序不保证。无 job 返空 slice。
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

// PooledJob —— 池子里的一条，附上它**还能活多久**。
// 设计里 `jobs.fetch_new` 的回执本来就写着 `ttl_remaining`
// （docs/design/job-loop.md 的 MCP tool surface），实现漏掉了。
type PooledJob struct {
	Job          jobsmodel.FetchedJob
	TTLRemaining time.Duration
}

// ListWindow —— 池子里**入池时间落在 since 之内**的全部 job，新的排在前面。
// since<=0 → 整个活池子。
//
// 入池时间不另存一份：key 的剩余 TTL 就是它（TTL 固定不 slide），
// age = p.ttl - remaining。多存一个字段就会有两个来源，而它们迟早不一致。
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
	// 剩余 TTL 越大 = 入池越晚。SCAN 的顺序没有意义，而"最新的排前面"有。
	slices.SortStableFunc(out, func(a, b PooledJob) int {
		return cmp.Compare(b.TTLRemaining, a.TTLRemaining)
	})
	return out, nil
}

// Discard —— 主动从池子里删（owner 决定不看了）。已不存在视同成功。
func (p *Pool) Discard(ctx context.Context, ownerID, cacheID string) error {
	if derr := p.rdb.Del(ctx, key(ownerID, cacheID)).Err(); derr != nil {
		return fmt.Errorf("redis del job: %w", derr)
	}
	return nil
}

// TTL —— 返回 key 剩余 TTL；测试用（也方便 admin debug）。0 = 不存在。
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

// withinWindow —— 只留下入池时间在 since 之内的。since<=0 → 全留。
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

// getWithTTL —— 每个 key 的正文和剩余 TTL。取不到（scan 与 exec 之间过期了）的
// 那条**跳过**，不是报错：池子本来就在过期。
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

// pipeGetTTL —— 一次 pipeline 发完所有 GET + TTL。
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
	// redis.Nil 是"某个 key 没了"，不是这一发失败 —— 逐条在 pooledFrom 里处理。
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return pooledCmds{}, fmt.Errorf("redis pipeline: %w", err)
	}
	return c, nil
}

// pooledCmds —— 一次 pipeline 里成对的 GET / TTL 结果，下标跟 keys 对齐。
type pooledCmds struct {
	gets []*redis.StringCmd
	ttls []*redis.DurationCmd
}

// pooledFrom —— 一对 (GET, TTL) 结果变成一行。**取不到就返回零值**（TTLRemaining==0），
// 调用方据此跳过：key 在 scan 与 exec 之间过期是常态，不是错误。
// 只有正文解不开才是真错 —— 那说明池子里躺着坏字节。
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

// stillPooled —— 这个 key 在 exec 的时候还活着吗。写成正向判定而不是
// 三个 `err != nil` 的早退：这里的"没取到"是**过期**，不是错误链上的失败。
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
			continue // key 在 scan 与 mget 之间过期了
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
