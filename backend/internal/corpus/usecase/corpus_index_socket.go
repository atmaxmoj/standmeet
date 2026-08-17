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

package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
	"github.com/atmaxmoj/standmeet/internal/infra/hostop"
)

// corpusIndexReq —— 插件经 socket 发来的请求。session scope 字段 + 原样转发的 args。
type corpusIndexReq struct {
	OwnerID        string          `json:"owner_id"`
	ConversationID string          `json:"conversation_id"`
	Args           json.RawMessage `json:"args"`
	// CorpusScope —— 整块回来的准入范围（宿主写进 `_meta`，插件原样转发）。
	// 拆成字段过线的写法已经废弃：漏一个成员不会编译失败，只会静默改变谁能读什么。
	CorpusScope access.CorpusScope `json:"corpus_scope"`
}

// corpusRunner —— 一个 op 的执行体：解析 args、调 lister、返 wire JSON。
type corpusRunner func(context.Context, Lister, *corpusIndexReq) (string, error)

// CorpusHostOpsFor —— prod 那套:从 postgres 的 IndexDeps 装出 pgCorpusLister,再声明这七件事。
func CorpusHostOpsFor(deps *IndexDeps) []hostop.Op {
	return CorpusHostOps(newPGLister(deps))
}

// newPGLister —— IndexDeps → pgCorpusLister。host ops 和 RefResolver 共用一句,
// 好让「waypoint 的 evidence_ref 解不解析得出」跟「agent 真读得到什么」是同一套 finder。
func newPGLister(deps *IndexDeps) *pgCorpusLister {
	return &pgCorpusLister{
		wiki: deps.Wiki, output: deps.Output, writing: deps.Writings,
		subjectivity: deps.Subjectivity, queryRepo: deps.VaultSync,
		noteRefs: deps.NoteRefs, searcher: deps.Searcher, media: deps.Media,
	}
}

// CorpusHostOps —— 本域开给沙箱能力的读语料那几件事,背后是任意 Lister。
//
// prod 经 CorpusHostOpsFor 注入 pgCorpusLister;agentcore 的 eval mini-host 注入一个
// Driver-backed 的内存 lister,让消费方不碰 postgres 也能装配。
//
// 名字保持 canonical(corpus_search 而不是 corpus.search):它们是 retrieval 插件一直在
// 用的那几个,搬家不改对外的称呼。
func CorpusHostOps(lister Lister) []hostop.Op {
	decl := []struct {
		run  corpusRunner
		name string
		desc string
	}{
		{runCorpusSearch, "corpus_search", searchToolDesc},
		{runCorpusRead, "corpus_read", "Read one entry by path, under the session's scope."},
		{runCorpusList, "corpus_list", "List entries under the session's scope."},
		{runCorpusLinks, "corpus_links", "The links out of / into one entry."},
		{runCorpusMap, "corpus_map", "The shape of the reachable corpus."},
		{runCorpusResolve, "corpus_resolve", "Resolve a title / partial address to an entry."},
		{runCorpusPeek, "corpus_peek", "A cheap look at one entry (no full body)."},
		{
			runCorpusGrep, "corpus_grep",
			"Every place a literal / regex pattern occurs, under the session's scope.",
		},
	}
	out := make([]hostop.Op, 0, len(decl))
	for _, d := range decl {
		out = append(out, hostop.Op{
			Name: d.name, Description: d.desc, Invoke: corpusOp(lister, d.run),
		})
	}
	return out
}

func corpusOp(lister Lister, run corpusRunner) hostop.Invoke {
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
		// Lang —— 想读哪一种语言(多语笔记)。不给 = 这条笔记的身份语言。
		Lang string `json:"lang"`
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
	return marshalReadResult(readWire(ctx, l, req, &entry, args.Lang)), nil
}

// readWire —— 装配 corpus_read 的回参:正文里的原生查询就地解析,素材跟着条目一起给。
//
// 素材那一步在这里,是因为**走到这里 ACL 已经放行了** —— 可见性继承是结构保证的,
// 不是又判一次。
func readWire(
	ctx context.Context, l Lister, req *corpusIndexReq, entry *Entry, want string,
) *readResultWire {
	body := entry.Body
	if qr, ok := l.(queryResolver); ok { // 服务端解析 standmeet-query 块(ACL-scoped)
		body = ResolveQueryBlocks(ctx, qr, req.OwnerID, corpusScopeOf(req), body)
	}
	// 多语:一次一种。两种都灌进上下文 = 同一件事付两遍 token,而且自相矛盾。
	view := ViewFor(body, want, identityLangOf(ctx, l, req.OwnerID, entry.ID), entry.Title)
	wire := &readResultWire{
		ID: entry.ID, Genre: entry.Genre, Body: view.Body,
		Path: entry.Path, Title: entry.Title, CSSClasses: entry.CSSClasses,
		ShowAsSource: entry.ShowAsSource,
		Lang:         view.Lang, Languages: view.Languages,
	}
	if ar, ok := l.(assetReader); ok {
		wire.Assets, wire.AssetURLs = ar.NoteMedia(ctx, req.OwnerID, entry.ID)
	}
	return wire
}

// identityLangOf —— 这条笔记的身份语言(读不到 → 空,那时落点是第一面)。
func identityLangOf(ctx context.Context, l Lister, ownerID, noteID string) string {
	lr, ok := l.(langReader)
	if !ok {
		return ""
	}
	lang, _ := lr.NoteLang(ctx, ownerID, noteID)
	return lang
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

// grepArgs —— corpus_grep 的入参(名字跟插件那侧的 schema 一一对应;对不上不会报错,
// 只会永远走默认值)。
type grepArgs struct {
	Pattern       string `json:"pattern"`
	Fixed         bool   `json:"fixed"`
	CaseSensitive bool   `json:"case_sensitive"`
}

// runCorpusGrep —— corpus_grep:模式 → 每一处命中。模式写坏了是**输入错误**,原样把那句
// 编译错误往上带(ErrGrepPattern 由面翻成一句人话),不是 500。
func runCorpusGrep(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args grepArgs
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	hits, err := l.Grep(ctx, req.OwnerID, corpusScopeOf(req), &GrepRequest{
		Pattern: strings.TrimSpace(args.Pattern), Fixed: args.Fixed,
		CaseSensitive: args.CaseSensitive,
	})
	if err != nil {
		// 模式写坏了 → 原样往上带那句话("invalid search pattern: missing closing )")。
		// 包一层 "corpus grep:" 只会在 agent 读到的那句前面加一个它做不了任何事的词。
		if errors.Is(err, ErrGrepPattern) {
			return "", fmt.Errorf("%w", err)
		}
		return "", fmt.Errorf("corpus grep: %w", err)
	}
	return marshalGrepHits(hits), nil
}

// grepRowWire —— 一条命中。lines 是原样的行(带行号),因为这个工具的答案就是"在这一行";
// matches 是这条笔记里的匹配总数(lines 可能只给了前几条)。
type grepRowWire struct {
	Path    string         `json:"path"`
	Title   string         `json:"title"`
	Genre   string         `json:"genre"`
	Lines   []grepLineWire `json:"lines"`
	Matches int            `json:"matches"`
}

type grepLineWire struct {
	Text string `json:"text"`
	Line int    `json:"line"`
}

func marshalGrepHits(hits []GrepHit) string {
	rows := make([]grepRowWire, 0, len(hits))
	for i := range hits {
		rows = append(rows, grepRowWire{
			Path: hits[i].Path, Title: hits[i].Title, Genre: hits[i].Genre,
			Matches: hits[i].Total, Lines: toGrepLines(hits[i].Lines),
		})
	}
	out, err := json.Marshal(rows)
	if err != nil {
		return errJSON("marshal grep hits")
	}
	return string(out)
}

func toGrepLines(lines []GrepLine) []grepLineWire {
	out := make([]grepLineWire, 0, len(lines))
	for i := range lines {
		out = append(out, grepLineWire{Line: lines[i].No, Text: lines[i].Text})
	}
	return out
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

// corpusScopeOf —— the request's corpus scope, exactly as the host froze it.
//
// It used to REBUILD the scope from two fields off the wire, which is how "this identity reads
// only what the owner published" got lost in transit: a member the rebuild did not know about
// silently defaulted to false. Now the scope crosses whole and is used whole.
func corpusScopeOf(req *corpusIndexReq) access.CorpusScope {
	return req.CorpusScope
}
