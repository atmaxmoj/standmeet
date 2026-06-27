// capreg_retrieval_socket.go —— corpus.retrieval 的 HOST 侧 compute plumbing (#144/#157)。
//
// 外置的 retrieval 插件（沙箱、断网）经 bind 进来的 unix socket 调三个 op:
//   - "corpus_search" → CorpusLister.Search（关键词搜 wiki/output/writing，ACL 在方法内）
//   - "corpus_read"   → CorpusLister.Get（按 path 取全文，ACL 准入；denied/not-found 分流）
//   - "corpus_list"   → CorpusLister.List（wiki 树逐层导航 + output/writing 扁平根层）
//
// 每个 op 用 session 携来的 corpus-URI scope（role snapshot 的 glob 白名单，经 _meta 转发；
// frozen，无 staleness）作为 grantedGlobs 调对应方法，返同一套 wire JSON。
//
// #157: CorpusLister 无状态——path→id 每次 DB 现解（wiki/output 下钻、writing 按 path 列），
// 不再需要 per-conversation 的 retriever 缓存 / seen 续命。旧的 retrieverCache 整体删除。

package usecases

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/capsocket"
)

const (
	// searchPageLimit —— corpus_search 一页上限（翻页留给 LLM 用 offset，当前固定首页）。
	searchPageLimit = 20
	// listPageLimit —— corpus_list 一层一页上限（宽子树翻页用 page）。
	listPageLimit = 50
)

// retrievalSockReq —— 插件经 socket 发来的请求。session scope 字段 + 原样转发的 args。
type retrievalSockReq struct {
	OwnerID        string          `json:"owner_id"`
	ConversationID string          `json:"conversation_id"`
	CorpusURIs     []string        `json:"corpus_uris"`
	Args           json.RawMessage `json:"args"`
}

// corpusRunner —— 一个 op 的执行体：解析 args、调 lister、返 wire JSON。
type corpusRunner func(context.Context, CorpusLister, *retrievalSockReq) (string, error)

// RegisterRetrievalSocket —— prod 接线：从 postgres 的 RetrievalDeps 建 pgCorpusLister，
// 注册三个 corpus op。
func RegisterRetrievalSocket(srv *capsocket.Server, deps *RetrievalDeps) {
	lister := &pgCorpusLister{wiki: deps.Wiki, output: deps.Output, writing: deps.Writings}
	RegisterRetrievalSocketLister(srv, lister)
}

// RegisterRetrievalSocketLister —— 把三个 corpus op 注册到 capsocket server，背后是任意
// CorpusLister。prod 经 RegisterRetrievalSocket 注入 pgCorpusLister；agentcore 的 eval
// mini-host 注入一个 Driver-backed 内存 lister，让 retrieval 不碰 postgres 也能装配。
func RegisterRetrievalSocketLister(srv *capsocket.Server, lister CorpusLister) {
	srv.Handle("corpus_search", corpusOp(lister, runCorpusSearch))
	srv.Handle("corpus_read", corpusOp(lister, runCorpusRead))
	srv.Handle("corpus_list", corpusOp(lister, runCorpusList))
}

func corpusOp(lister CorpusLister, run corpusRunner) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req retrievalSockReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("retrieval req: %w", err)
		}
		out, rerr := run(ctx, lister, &req)
		if rerr != nil {
			return nil, rerr
		}
		return json.RawMessage(out), nil
	}
}

func runCorpusSearch(ctx context.Context, l CorpusLister, req *retrievalSockReq) (string, error) {
	var args struct {
		Query string `json:"query"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	rows, err := l.Search(ctx, req.OwnerID, req.CorpusURIs, strings.TrimSpace(args.Query))
	if err != nil {
		return "", fmt.Errorf("corpus search: %w", err)
	}
	return marshalCorpusRows(rows), nil
}

func runCorpusRead(ctx context.Context, l CorpusLister, req *retrievalSockReq) (string, error) {
	var args struct {
		Path string `json:"path"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	if args.Path == "" {
		return errJSON("path required"), nil
	}
	entry, err := l.Get(ctx, req.OwnerID, req.CorpusURIs, args.Path)
	if err != nil {
		return corpusReadErrWire(err, args.Path)
	}
	return marshalReadResult(entry.ID, entry.Genre, entry.Body, entry.Path, entry.Title), nil
}

// corpusReadErrWire —— map Get's failure to the wire: denied/not-found are friendly tool
// envelopes (ok=true, result.error), anything else is a real transport error.
func corpusReadErrWire(err error, path string) (string, error) {
	switch {
	case errors.Is(err, ErrCorpusDenied):
		return errJSON("access denied: " + path), nil
	case errors.Is(err, ErrCorpusNotFound):
		return errJSON("not found: " + path), nil
	default:
		return "", fmt.Errorf("corpus read: %w", err)
	}
}

func runCorpusList(ctx context.Context, l CorpusLister, req *retrievalSockReq) (string, error) {
	var args struct {
		Path string `json:"path"`
		Page int    `json:"page"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	rows, err := l.List(ctx, req.OwnerID, req.CorpusURIs, args.Path, args.Page)
	if err != nil {
		return corpusListErrWire(err) // 未知地址等 → friendly 行，不 502
	}
	return marshalCorpusRows(rows), nil
}

// corpusListErrWire —— list 的错误（未知地址等）→ friendly tool envelope，永不 502。
func corpusListErrWire(err error) (string, error) {
	return errJSON("list: " + err.Error()), nil
}

// marshalCorpusRows —— []CorpusMeta → 既有 wire（[{path,title,genre,summary?}]）。Snippet
// 仅 search 填，list 行为空 → omitempty 落掉 summary，复刻旧 list/search wire 差异。
func marshalCorpusRows(metas []CorpusMeta) string {
	rows := make([]corpusRow, 0, len(metas))
	for i := range metas {
		rows = append(rows, corpusRow{
			Path: metas[i].Path, Title: metas[i].Title,
			Genre: metas[i].Genre, Summary: metas[i].Snippet,
		})
	}
	return marshalRows(rows)
}
