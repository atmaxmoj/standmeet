// capreg_retrieval_socket.go —— 归一(#144): corpus.retrieval 的 HOST 侧 compute plumbing。
//
// 外置的 retrieval 插件（沙箱、断网）经 bind 进来的 unix socket 调三个 op：
//   - "corpus_search" → runSearch（关键词搜 wiki/output/writing，ACL 过滤）
//   - "corpus_read"   → runRead（按 path 取全文，ACL 准入）
//   - "corpus_list"   → runList（wiki 树逐层导航，ACL 过滤）
//
// 每个 op 用 session 携来的 corpus-URI scope（role snapshot 的 glob 白名单，经 _meta
// 转发；frozen，无 staleness）重建一个最小 RoleSnapshot，装出 retriever，调对应方法、
// 返同一套 wire JSON。
//
// retriever 按 conversation_id 缓存（带 TTL）：in-process 时代同一个 turn 的 search+read
// 共用一个 retriever 实例，read 靠 search 填进的 seen(path→id) 反查超出内存-50 窗口的
// entry。外置后每个 socket op 独立调用，若每次新建 retriever 就丢了 seen → 深层 output
// 读不到、引不上（output-retrieval-scale）。缓存把同会话的 retriever 续上，复刻旧行为。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

const (
	retrieverTTL      = 5 * time.Minute // 覆盖一个 turn 的 search→read；过期重建防 corpus 漂移
	retrieverCacheMax = 256             // 上限，满了整体清空（简单有界，不做 LRU）
)

// retrievalSockReq —— 插件经 socket 发来的请求。session scope 字段 + 原样转发的 args。
type retrievalSockReq struct {
	OwnerID        string          `json:"owner_id"`
	ConversationID string          `json:"conversation_id"`
	CorpusURIs     []string        `json:"corpus_uris"`
	Args           json.RawMessage `json:"args"`
}

// retrieverCache —— per-conversation retriever 缓存（seen 续命）。nil-safe via methods。
type retrieverCache struct {
	entries map[string]cachedRetriever
	mu      sync.Mutex
}

type cachedRetriever struct {
	builtAt time.Time
	r       *retriever
}

// RegisterRetrievalSocket —— 把三个 corpus op 注册到 capsocket server。
func RegisterRetrievalSocket(srv *capsocket.Server, deps *RetrievalDeps) {
	cache := &retrieverCache{entries: map[string]cachedRetriever{}}
	srv.Handle("corpus_search", retrievalOpHandler(deps, cache,
		func(ctx context.Context, r *retriever, args []byte) (string, error) {
			return r.runSearch(ctx, args)
		}))
	srv.Handle("corpus_read", retrievalOpHandler(deps, cache,
		func(ctx context.Context, r *retriever, args []byte) (string, error) {
			return r.runRead(ctx, args)
		}))
	srv.Handle("corpus_list", retrievalOpHandler(deps, cache,
		func(ctx context.Context, r *retriever, args []byte) (string, error) {
			return r.runList(ctx, args)
		}))
}

func retrievalOpHandler(
	deps *RetrievalDeps, cache *retrieverCache,
	run func(context.Context, *retriever, []byte) (string, error),
) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req retrievalSockReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("retrieval req: %w", err)
		}
		retr, berr := cache.getOrBuild(ctx, deps, &req)
		if berr != nil {
			return nil, berr
		}
		out, rerr := run(ctx, retr, req.Args)
		if rerr != nil {
			return nil, rerr
		}
		return json.RawMessage(out), nil
	}
}

// getOrBuild —— 同 conversation 复用上次的 retriever（seen 续命），过期/无 id/未命中则
// 新建。无 conversation_id（无状态调用）→ 不缓存，直接新建。
func (c *retrieverCache) getOrBuild(
	ctx context.Context, deps *RetrievalDeps, req *retrievalSockReq,
) (*retriever, error) {
	if req.ConversationID == "" {
		return buildRetrieverFromReq(ctx, deps, req)
	}
	if r := c.fresh(req.ConversationID); r != nil {
		return r, nil
	}
	retr, err := buildRetrieverFromReq(ctx, deps, req)
	if err != nil {
		return nil, err
	}
	c.store(req.ConversationID, retr)
	return retr, nil
}

// fresh —— 命中且未过期的缓存 retriever，否则 nil。
func (c *retrieverCache) fresh(key string) *retriever {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e, ok := c.entries[key]; ok && time.Since(e.builtAt) < retrieverTTL {
		return e.r
	}
	return nil
}

// store —— 存入缓存；满了整体清空（简单有界）。
func (c *retrieverCache) store(key string, r *retriever) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= retrieverCacheMax {
		c.entries = map[string]cachedRetriever{}
	}
	c.entries[key] = cachedRetriever{r: r, builtAt: time.Now()}
}

func buildRetrieverFromReq(
	ctx context.Context, deps *RetrievalDeps, req *retrievalSockReq,
) (*retriever, error) {
	return buildRetriever(ctx, *deps, &retrieverBuildInput{
		ownerID:  req.OwnerID,
		snapshot: retrievalSnapshot(req.CorpusURIs),
	})
}

// retrievalSnapshot —— 从 session 携来的 corpus-URI glob 白名单重建一个最小 RoleSnapshot；
// retriever 只用 snapshot 的 AllowsCorpus 做 ACL，别的字段无关。空 scope → 空白名单
// （AllowsCorpus 一律 deny，search/read/list 自然返空 / not found）。
func retrievalSnapshot(corpusURIs []string) *domain.RoleSnapshot {
	snap := domain.NewRoleSnapshot(&domain.RoleSnapshotInit{CorpusURIs: corpusURIs})
	return &snap
}
