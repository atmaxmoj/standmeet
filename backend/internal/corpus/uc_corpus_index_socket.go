// corpus_index_socket.go —— corpus indexing(检索/导航)的 HOST 侧 compute plumbing (#144/#157)。
//
// 外置的消费方插件（沙箱、断网，如 retrieval/summarize）经 bind 进来的 unix socket 调三个 op:
//   - "corpus_search" → Lister.Search（关键词搜 wiki/output/writing，ACL 在方法内）
//   - "corpus_read"   → Lister.Get（按 path 取全文，ACL 准入；denied/not-found 分流）
//   - "corpus_list"   → Lister.List（wiki 树逐层导航 + output/writing 扁平根层）
//
// 每个 op 用 session 携来的 corpus-URI scope（role snapshot 的 glob 白名单，经 _meta 转发；
// frozen，无 staleness）作为 grantedGlobs 调对应方法，返同一套 wire JSON。
//
// #157: Lister 无状态——path→id 每次 DB 现解（wiki/output 下钻、writing 按 path 列），
// 不再需要 per-conversation 的 retriever 缓存 / seen 续命。旧的 retrieverCache 整体删除。

package corpus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/atmaxmoj/standmeet/internal/access"
	"github.com/atmaxmoj/standmeet/internal/capabilities/capsocket"
)

// corpusIndexReq —— 插件经 socket 发来的请求。session scope 字段 + 原样转发的 args。
type corpusIndexReq struct {
	OwnerID        string          `json:"owner_id"`
	ConversationID string          `json:"conversation_id"`
	CorpusURIs     []string        `json:"corpus_uris"`
	CorpusDenials  []string        `json:"corpus_denials"`
	Args           json.RawMessage `json:"args"`
}

// corpusRunner —— 一个 op 的执行体：解析 args、调 lister、返 wire JSON。
type corpusRunner func(context.Context, Lister, *corpusIndexReq) (string, error)

// RegisterCorpusIndexSocket —— prod 接线：从 postgres 的 IndexDeps 建 pgCorpusLister，
// 注册三个 corpus op。
func RegisterCorpusIndexSocket(srv *capsocket.Server, deps *IndexDeps) {
	lister := &pgCorpusLister{
		wiki: deps.Wiki, output: deps.Output, writing: deps.Writings,
		subjectivity: deps.Subjectivity, queryRepo: deps.VaultSync,
		noteRefs: deps.NoteRefs, searcher: deps.Searcher,
	}
	RegisterCorpusIndexLister(srv, lister)
}

// RegisterCorpusIndexLister —— 把三个 corpus op 注册到 capsocket server，背后是任意
// Lister。prod 经 RegisterCorpusIndexSocket 注入 pgCorpusLister；agentcore 的 eval
// mini-host 注入一个 Driver-backed 内存 lister，让消费方不碰 postgres 也能装配。
func RegisterCorpusIndexLister(srv *capsocket.Server, lister Lister) {
	srv.Handle("corpus_search", corpusOp(lister, runCorpusSearch))
	srv.Handle("corpus_read", corpusOp(lister, runCorpusRead))
	srv.Handle("corpus_list", corpusOp(lister, runCorpusList))
	srv.Handle("corpus_links", corpusOp(lister, runCorpusLinks))
	srv.Handle("corpus_map", corpusOp(lister, runCorpusMap))
	srv.Handle("corpus_resolve", corpusOp(lister, runCorpusResolve))
	srv.Handle("corpus_peek", corpusOp(lister, runCorpusPeek))
}

func corpusOp(lister Lister, run corpusRunner) capsocket.Handler {
	return func(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
		var req corpusIndexReq
		if err := json.Unmarshal(raw, &req); err != nil {
			return nil, fmt.Errorf("corpus index req: %w", err)
		}
		out, rerr := run(ctx, lister, &req)
		if rerr != nil {
			return nil, rerr
		}
		return json.RawMessage(out), nil
	}
}

func runCorpusSearch(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args struct {
		Query string `json:"query"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	rows, err := l.Search(ctx, req.OwnerID, corpusScopeOf(req), strings.TrimSpace(args.Query))
	if err != nil {
		return "", fmt.Errorf("corpus search: %w", err)
	}
	return marshalCorpusRows(rows), nil
}

func runCorpusRead(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args struct {
		Path string `json:"path"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	if args.Path == "" {
		return errJSON("path required"), nil
	}
	entry, err := l.Get(ctx, req.OwnerID, corpusScopeOf(req), args.Path)
	if err != nil {
		return corpusReadErrWire(err, args.Path)
	}
	body := entry.Body
	if qr, ok := l.(queryResolver); ok { // 服务端解析 standmeet-query 块(ACL-scoped)
		body = ResolveQueryBlocks(ctx, qr, req.OwnerID, corpusScopeOf(req), body)
	}
	return marshalReadResult(&readResultWire{
		ID: entry.ID, Genre: entry.Genre, Body: body,
		Path: entry.Path, Title: entry.Title, CSSClasses: entry.CSSClasses,
		ShowAsSource: entry.ShowAsSource,
	}), nil
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

func runCorpusList(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args struct {
		Path string `json:"path"`
		Page int    `json:"page"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	rows, err := l.List(ctx, req.OwnerID, corpusScopeOf(req), args.Path, args.Page)
	if err != nil {
		return corpusListErrWire(err) // 未知地址等 → friendly 行，不 502
	}
	return marshalCorpusRows(rows), nil
}

// corpusListErrWire —— list 的错误（未知地址等）→ friendly tool envelope，永不 502。
func corpusListErrWire(err error) (string, error) {
	return errJSON("list: " + err.Error()), nil
}

func runCorpusLinks(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args struct {
		Path string `json:"path"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	if args.Path == "" {
		return errJSON("path required"), nil
	}
	links, err := l.Links(ctx, req.OwnerID, corpusScopeOf(req), args.Path)
	if err != nil {
		return corpusReadErrWire(err, args.Path) // denied/not-found → friendly envelope
	}
	return marshalLinks(&links), nil
}

// linksWire —— corpus_links wire:分开 outgoing(本条引用的)/ backlinks(引用本条的)。
type linksWire struct {
	Outgoing  []Row `json:"outgoing"`
	Backlinks []Row `json:"backlinks"`
}

func marshalLinks(links *Links) string {
	wire := linksWire{
		Outgoing:  toCorpusRows(links.Outgoing),
		Backlinks: toCorpusRows(links.Backlinks),
	}
	out, err := json.Marshal(wire)
	if err != nil {
		return errJSON("marshal links")
	}
	return string(out)
}

func toCorpusRows(metas []Meta) []Row {
	rows := make([]Row, 0, len(metas))
	for i := range metas {
		rows = append(rows, Row{
			Path: metas[i].Path, Title: metas[i].Title, Genre: metas[i].Genre,
		})
	}
	return rows
}

// marshalCorpusRows —— []Meta → 既有 wire（[{path,title,genre,summary?}]）。Snippet
// 仅 search 填，list 行为空 → omitempty 落掉 summary，复刻旧 list/search wire 差异。
func marshalCorpusRows(metas []Meta) string {
	rows := make([]Row, 0, len(metas))
	for i := range metas {
		rows = append(rows, Row{
			Path: metas[i].Path, Title: metas[i].Title,
			Genre: metas[i].Genre, Summary: metas[i].Snippet,
		})
	}
	return marshalRows(rows)
}

// corpusScopeOf —— the request's full corpus scope: role grant + this code's narrowing.
// Built in ONE place so no op can accidentally pass the grant alone (which would serve what the
// owner took back).
func corpusScopeOf(req *corpusIndexReq) access.CorpusScope {
	return access.CorpusScope{Granted: req.CorpusURIs, Denied: req.CorpusDenials}
}
