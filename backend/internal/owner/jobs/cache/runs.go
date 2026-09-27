// runs.go —— one source's fetch outcome, kept beside the pool it wrote into, for as long as the
// pool keeps its jobs. A fetch runs as one background job per source; whoever assembles the fetch's
// answer (the request that waited, or jobs.fetch_result later) reads the outcomes back from here.
//
// Key shape: jobrun:{run_id}:{source_id} → the outcome's JSON, same TTL as the pool. Outside the
// job: prefix, so the pool's SCAN never sees them.

package cache

import (
	"context"
	"errors"
	"fmt"

	"github.com/redis/go-redis/v9"
)

const runKeyPrefix = "jobrun:"

// PutRun —— stores one source's outcome of a fetch run (raw JSON).
func (p *Pool) PutRun(ctx context.Context, runID, sourceID string, raw []byte) error {
	if err := p.rdb.Set(ctx, runKey(runID, sourceID), raw, p.ttl).Err(); err != nil {
		return fmt.Errorf("redis set fetch outcome: %w", err)
	}
	return nil
}

// GetRun —— one source's stored outcome; ErrCacheMiss when there is none (not finished, or gone).
func (p *Pool) GetRun(ctx context.Context, runID, sourceID string) ([]byte, error) {
	raw, err := p.rdb.Get(ctx, runKey(runID, sourceID)).Bytes()
	if errors.Is(err, redis.Nil) {
		return nil, ErrCacheMiss
	}
	if err != nil {
		return nil, fmt.Errorf("redis get fetch outcome: %w", err)
	}
	return raw, nil
}

func runKey(runID, sourceID string) string { return runKeyPrefix + runID + ":" + sourceID }
