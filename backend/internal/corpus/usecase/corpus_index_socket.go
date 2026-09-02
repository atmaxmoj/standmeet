// corpus_index_socket.go — HOST-side compute plumbing for corpus indexing (search / nav)
// (#144/#157).
//
// Sandboxed, no-network consumer plugins (e.g. retrieval/summarize) call three ops over the
// unix socket bound in for them: "corpus_search" (Lister.Search, keyword search over
// wiki/output/writing, ACL inside the method), "corpus_read" (Lister.Get, fetch full text by
// path, ACL-gated, denied/not-found handled separately), "corpus_list" (Lister.List, wiki
// tree nav level by level plus output/writing flat root level).
//
// Each op calls its method with the corpus-URI scope the session carries (the role
// snapshot's glob allowlist, forwarded via _meta; frozen, no staleness) as grantedGlobs,
// and returns the same wire JSON shape.
//
// #157: Lister is stateless — path→id resolves fresh against the DB every call, so a
// per-conversation retriever cache is no longer needed; the old retrieverCache is deleted.

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

// corpusIndexReq — the request a plugin sends over the socket. Session-scope fields plus
// args forwarded as-is.
type corpusIndexReq struct {
	OwnerID        string          `json:"owner_id"`
	ConversationID string          `json:"conversation_id"`
	Args           json.RawMessage `json:"args"`
	// CorpusScope — the admission scope, carried whole (host writes it into `_meta`, plugin
	// forwards it verbatim). Splitting it into separate wire fields is retired: a missing
	// member wouldn't fail to compile, it would silently change who can read what.
	CorpusScope access.CorpusScope `json:"corpus_scope"`
}

// corpusRunner — the body of one op: parse args, call the lister, return wire JSON.
type corpusRunner func(context.Context, Lister, *corpusIndexReq) (string, error)

// CorpusHostOpsFor — the prod wiring: assembles a pgCorpusLister from the postgres-backed
// IndexDeps, then declares these seven ops.
func CorpusHostOpsFor(deps *IndexDeps) []hostop.Op {
	return CorpusHostOps(newPGLister(deps))
}

// newPGLister — IndexDeps → pgCorpusLister. Host ops and RefResolver share this one call,
// so "can a waypoint's evidence_ref resolve" and "what an agent can read" run through it.
func newPGLister(deps *IndexDeps) *pgCorpusLister {
	return &pgCorpusLister{
		wiki: deps.Wiki, output: deps.Output, writing: deps.Writings,
		subjectivity: deps.Subjectivity, queryRepo: deps.VaultSync,
		noteRefs: deps.NoteRefs, searcher: deps.Searcher, media: deps.Media,
	}
}

// CorpusHostOps — the corpus-reading ops this domain exposes to sandboxed capabilities,
// backed by any Lister. Prod injects a pgCorpusLister via CorpusHostOpsFor; agentcore's eval
// mini-host injects a Driver-backed in-memory lister, so a consumer assembles without ever
// touching postgres. Names stay canonical (corpus_search, not corpus.search) — these are
// the same ops the retrieval plugin has always used; moving the wiring doesn't rename the
// outward contract.
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
	return marshalSearchResult(rows), nil
}

func runCorpusRead(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args struct {
		Path string `json:"path"`
		// Lang — which language to read (for a multi-language note). Omitted = the note's
		// identity language.
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

// readWire — assembles the corpus_read response: in-body native queries resolve in place,
// and assets are handed over with the entry. The asset step lives here because **ACL has
// already granted access by this point** — visibility inheritance is structural, not a
// second check.
func readWire(
	ctx context.Context, l Lister, req *corpusIndexReq, entry *Entry, want string,
) *readResultWire {
	body := entry.Body
	if qr, ok := l.(queryResolver); ok { // resolves standmeet-query blocks server-side (ACL-scoped)
		body = ResolveQueryBlocks(ctx, qr, req.OwnerID, corpusScopeOf(req), body)
	}
	// Multi-language: one at a time. Feeding both into context pays token cost twice for the
	// same thing, and contradicts itself.
	view := ViewFor(body, want, identityLangOf(ctx, l, req.OwnerID, entry.ID), entry.Title)
	wire := &readResultWire{
		ID: entry.ID, Genre: entry.Genre, Body: view.Body,
		Path: entry.Path, Slug: entry.Slug, Title: entry.Title, CSSClasses: entry.CSSClasses,
		ShowAsSource: entry.ShowAsSource,
		Lang:         view.Lang, Languages: view.Languages,
	}
	if ar, ok := l.(assetReader); ok {
		wire.Assets, wire.AssetURLs = ar.NoteMedia(ctx, req.OwnerID, entry.ID)
	}
	return wire
}

// identityLangOf — this note's identity language (unreadable → empty, in which case the
// fallback is the first face).
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
		return corpusListErrWire(err) // unknown address etc. → friendly line, not a 502
	}
	return marshalCorpusRows(rows), nil
}

// corpusListErrWire — list's errors (unknown address, etc.) → a friendly tool envelope,
// never a 502.
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

// grepArgs — corpus_grep's input (names match the plugin-side schema one-to-one; a
// mismatch won't error, it'll just silently fall through to the zero value forever).
type grepArgs struct {
	Pattern       string `json:"pattern"`
	Fixed         bool   `json:"fixed"`
	CaseSensitive bool   `json:"case_sensitive"`
}

// runCorpusGrep — corpus_grep: pattern → every hit. A malformed pattern is **user input
// error**; ErrGrepPattern's message carries up verbatim to a human-readable line at the
// face, not a 500.
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
		// Carry a malformed pattern's message up verbatim ("invalid search pattern:
		// missing closing )"); wrapping it in "corpus grep:" would prefix the agent's
		// line with a word it can't act on.
		if errors.Is(err, ErrGrepPattern) {
			return "", fmt.Errorf("%w", err)
		}
		return "", fmt.Errorf("corpus grep: %w", err)
	}
	return marshalGrepHits(hits), nil
}

// grepRowWire — one hit. Lines are the raw lines (numbered), since the answer is "it's on
// this line"; Matches is the total match count in the note (Lines may carry only the first few).
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

// linksWire — the corpus_links wire shape: separates outgoing (what this entry links to)
// / backlinks (what links to this entry).
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

// marshalCorpusRows — []Meta → the existing wire shape ([{path,title,genre,summary?}]).
// Snippet fills only from search; list leaves it empty, so omitempty drops summary,
// reproducing the old list/search wire difference.
func marshalCorpusRows(metas []Meta) string {
	return marshalRows(rowsOf(metas))
}

// corpusScopeOf — the request's corpus scope, exactly as the host froze it. It used to
// REBUILD the scope from two wire fields, which is how "reads only what the owner published"
// got lost: a member the rebuild didn't know about silently defaulted to false. Now the
// scope crosses whole and is used whole.
func corpusScopeOf(req *corpusIndexReq) access.CorpusScope {
	return req.CorpusScope
}
