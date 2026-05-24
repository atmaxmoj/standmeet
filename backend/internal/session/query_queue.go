// query_queue.go —— visitor chat 推理请求的双层限流。设计源自 legacy
// standmeet-server/gateway/src/session/query-queue.ts。
//
//   1. 全局 concurrent cap：同时只允许 maxConcurrent 个 inference query
//      在跑（owner 的 anthropic/openai 配额防爆）。
//   2. Per-session in-flight cap：同一个 visitor session 同时最多 1 个
//      query（防 visitor 连发 SSE，每个都跑 agent loop 把 owner 账单烧光）。
//
// 排队规则：拿不到位 → 等到 timeout 触发 ErrQueueTimeout。caller (visitor_chat)
// 走 HTTP 503 / "server busy" 友好降级，不挂 SSE error event。

package session

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// ErrQueueTimeout —— 等位超时；caller 翻成 HTTP 503 / "server busy"。
var ErrQueueTimeout = errors.New("query queue timeout")

// ErrSessionBusy —— 该 session 已有 in-flight query；caller 翻成 429。
// 跟 ErrQueueTimeout 区分：前者是"自己 session 撞墙"，后者是"全局满"。
var ErrSessionBusy = errors.New("session already has an in-flight query")

// QueryQueue —— 双层 cap：global maxConcurrent + per-session 唯一性。
type QueryQueue struct {
	cond          *sync.Cond          // 等位唤醒
	active        map[string]struct{} // sessionID → in-flight 标记
	maxConcurrent int
	mu            sync.Mutex
}

// NewQueryQueue —— maxConcurrent 全局上限；≤0 视为不限流（dev 默认）。
func NewQueryQueue(maxConcurrent int) *QueryQueue {
	q := &QueryQueue{maxConcurrent: maxConcurrent, active: map[string]struct{}{}}
	q.cond = sync.NewCond(&q.mu)
	return q
}

// Acquire —— sessionID 入队 + 等待位子。timeout 到了返 ErrQueueTimeout。
// 同 sessionID 重入直接返 ErrSessionBusy（不等位）。
func (q *QueryQueue) Acquire(ctx context.Context, sessionID string, timeout time.Duration) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	if _, busy := q.active[sessionID]; busy {
		return ErrSessionBusy
	}
	if err := q.waitCapacity(ctx, timeout); err != nil {
		return err
	}
	q.active[sessionID] = struct{}{}
	return nil
}

// waitForSlot —— cond.Wait 配 deadline；用单独 goroutine 在 deadline 或
// ctx cancel 时 Broadcast 让所有 waiter 重新 evaluate 条件并失败退出。
func waitForSlot(ctx context.Context, cond *sync.Cond, deadline time.Time) error {
	if time.Until(deadline) <= 0 {
		return ErrQueueTimeout
	}
	done := make(chan struct{})
	defer close(done)
	go waitWakeup(ctx, cond, deadline, done)
	cond.Wait()
	return checkWaitResult(ctx, deadline)
}

func waitWakeup(ctx context.Context, cond *sync.Cond, deadline time.Time, done <-chan struct{}) {
	select {
	case <-time.After(time.Until(deadline)):
	case <-ctx.Done():
	case <-done:
		return
	}
	cond.L.Lock()
	cond.Broadcast()
	cond.L.Unlock()
}

func checkWaitResult(ctx context.Context, deadline time.Time) error {
	if cerr := ctx.Err(); cerr != nil {
		return fmt.Errorf("query queue ctx: %w", cerr)
	}
	if time.Now().After(deadline) {
		return ErrQueueTimeout
	}
	return nil
}

// Release —— query 完了释放位子，唤醒一个 waiter。
func (q *QueryQueue) Release(sessionID string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	delete(q.active, sessionID)
	q.cond.Signal()
}

// Active —— 当前 in-flight query 数；admin / metrics 用。
func (q *QueryQueue) Active() int {
	q.mu.Lock()
	defer q.mu.Unlock()
	return len(q.active)
}

// waitCapacity —— maxConcurrent ≤ 0 直接通过；否则 cond.Wait 到位子或超时。
// 调用方必须持 q.mu。
func (q *QueryQueue) waitCapacity(ctx context.Context, timeout time.Duration) error {
	if q.maxConcurrent <= 0 {
		return nil
	}
	deadline := time.Now().Add(timeout)
	for len(q.active) >= q.maxConcurrent {
		if err := waitForSlot(ctx, q.cond, deadline); err != nil {
			return err
		}
	}
	return nil
}
