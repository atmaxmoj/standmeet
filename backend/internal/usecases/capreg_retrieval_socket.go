// capreg_retrieval_socket.go —— 归一(#144): corpus.retrieval 的 HOST 侧 compute plumbing。
//
// 外置的 retrieval 插件（沙箱、断网）经 bind 进来的 unix socket 调三个 op：
//   - "corpus_search" → runSearch（关键词搜 wiki/output/writing，ACL 过滤）
//   - "corpus_read"   → runRead（按 path 取全文，ACL 准入）
//   - "corpus_list"   → runList（wiki 树逐层导航，ACL 过滤）
//
// 每个 op 用 session 携来的 corpus-URI scope（role snapshot 的 glob 白名单，经 _meta
// 转发；frozen，无 staleness）重建一个最小 RoleSnapshot，buildRetriever 装出 retriever，
// 调对应方法、返同一套 wire JSON（不变）。citation 不在这：inference 的 accumSink 从
// corpus_read 结果 {id,genre} 自己累计。

package usecases

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
	"github.com/atmaxmoj/standmeet/internal/domain"
)

// retrievalSockReq —— 插件经 socket 发来的请求。session scope 字段 + 原样转发的 args。
type retrievalSockReq struct {
	OwnerID    string          `json:"owner_id"`
	CorpusURIs []string        `json:"corpus_uris"`
	Args       json.RawMessage `json:"args"`
}

// RegisterRetrievalSocket —— 把三个 corpus op 注册到 capsocket server。
func RegisterRetrievalSocket(srv *capsocket.Server, deps *RetrievalDeps) {
	srv.Handle("corpus_search", retrievalOpHandler(deps,
		func(ctx context.Context, r *retriever, args []byte) (string, error) {
			return r.runSearch(ctx, args)
		}))
	srv.Handle("corpus_read", retrievalOpHandler(deps,
		func(ctx context.Context, r *retriever, args []byte) (string, error) {
			return r.runRead(ctx, args)
		}))
	srv.Handle("corpus_list", retrievalOpHandler(deps,
		func(ctx context.Context, r *retriever, args []byte) (string, error) {
			return r.runList(ctx, args)
		}))
}

// retrievalOpHandler —— 三个 op 同形：解 session+args、用 scope 装一个 retriever、跑
// run（search/read/list），把 run 返的 wire JSON 字符串原样回去。run 返的就是给 agent
// 的 result（含 ACL deny 也是 {error:...} / "not found"），handler 只在解码 / 装 retriever
// 硬失败时返 error（由 capsocket 折成 {"error":...}）。
func retrievalOpHandler(
	deps *RetrievalDeps,
	run func(context.Context, *retriever, []byte) (string, error),
) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req retrievalSockReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("retrieval req: %w", err)
		}
		retr, berr := buildRetriever(ctx, *deps, &retrieverBuildInput{
			ownerID:  req.OwnerID,
			snapshot: retrievalSnapshot(req.CorpusURIs),
		})
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

// retrievalSnapshot —— 从 session 携来的 corpus-URI glob 白名单重建一个最小 RoleSnapshot；
// retriever 只用 snapshot 的 AllowsCorpus 做 ACL，别的字段无关。空 scope → 空白名单
// （AllowsCorpus 一律 deny，search/read/list 自然返空 / not found）。
func retrievalSnapshot(corpusURIs []string) *domain.RoleSnapshot {
	snap := domain.NewRoleSnapshot(&domain.RoleSnapshotInit{CorpusURIs: corpusURIs})
	return &snap
}
