// corpus_index_nav.go —— host runners for the navigation ops added on top of the
// original search/read/list/links four: corpus_map (adaptive skeleton), corpus_resolve
// (name→node), corpus_peek (cheap stubs for N nodes). Each parses args, calls the lister, and
// marshals the wire — the shaping/stub logic is pure and lives beside them / in corpus_map.go.

package usecase

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// runCorpusMap —— corpus_map(under?, budget?) → the budget-bounded node skeleton.
func runCorpusMap(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args struct {
		Under  string `json:"under"`
		Budget int    `json:"budget"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	entries, err := l.MapEntries(ctx, req.OwnerID, corpusScopeOf(req))
	if err != nil {
		return "", fmt.Errorf("corpus map: %w", err)
	}
	nodes := BuildCorpusMap(entries, strings.Trim(args.Under, "/"), args.Budget)
	out, merr := json.Marshal(corpusMapWire{Nodes: nodes, Total: len(entries)})
	if merr != nil {
		return "", fmt.Errorf("marshal map: %w", merr)
	}
	return string(out), nil
}

// corpusMapWire —— corpus_map result: the skeleton + total visible node count.
type corpusMapWire struct {
	Nodes []MapNode `json:"nodes"`
	Total int       `json:"total"`
}

// runCorpusResolve —— corpus_resolve(name) → matching node rows (0..n).
func runCorpusResolve(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args struct {
		Name string `json:"name"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	if strings.TrimSpace(args.Name) == "" {
		return errJSON("name required"), nil
	}
	metas, err := l.Resolve(ctx, req.OwnerID, corpusScopeOf(req), strings.TrimSpace(args.Name))
	if err != nil {
		return "", fmt.Errorf("corpus resolve: %w", err)
	}
	return marshalCorpusRows(metas), nil
}

// corpusStub —— the light "signature" of a node (title/tags/headings/outlinks/first line),
// the mid-tier between a search snippet (too thin) and corpus_read (full body, expensive).
type corpusStub struct {
	Path     string   `json:"path"`
	Title    string   `json:"title"`
	Genre    string   `json:"genre"`
	Lead     string   `json:"lead,omitempty"`
	Error    string   `json:"error,omitempty"`
	Tags     []string `json:"tags,omitempty"`
	Headings []string `json:"headings,omitempty"`
	Outlinks []string `json:"outlinks,omitempty"`
}

const (
	peekMaxPaths    = 30
	peekLeadMax     = 240
	peekMaxHeadings = 12
	peekMaxOutlinks = 20
)

// runCorpusPeek —— corpus_peek(paths[]) → a stub per path, in one call. Reuses Get (same ACL);
// the wire saving is the agent sees signatures, not N full bodies. Per-path errors don't fail
// the batch — a denied/missing path returns a stub with `error` set.
func runCorpusPeek(ctx context.Context, l Lister, req *corpusIndexReq) (string, error) {
	var args struct {
		Paths []string `json:"paths"`
	}
	if uerr := json.Unmarshal(req.Args, &args); uerr != nil {
		return "", fmt.Errorf("invalid arguments: %w", uerr)
	}
	if len(args.Paths) == 0 {
		return errJSON("paths required"), nil
	}
	paths := capPaths(args.Paths)
	stubs := make([]corpusStub, 0, len(paths))
	for _, p := range paths {
		stubs = append(stubs, peekOne(ctx, l, req, p))
	}
	out, merr := json.Marshal(corpusPeekWire{Stubs: stubs})
	if merr != nil {
		return "", fmt.Errorf("marshal peek: %w", merr)
	}
	return string(out), nil
}

// corpusPeekWire —— corpus_peek result: one stub per requested path.
type corpusPeekWire struct {
	Stubs []corpusStub `json:"stubs"`
}

// capPaths —— bound the batch so one call can't fan out into a huge read burst.
func capPaths(paths []string) []string {
	if len(paths) > peekMaxPaths {
		return paths[:peekMaxPaths]
	}
	return paths
}

// peekOne —— one node's stub, or an error stub (denied/not-found), so a bad path never fails
// the whole batch. Reuses Get for ACL + body; signatureFromEntry extracts the signature (pure).
func peekOne(ctx context.Context, l Lister, req *corpusIndexReq, path string) corpusStub {
	path = strings.TrimSpace(path)
	if path == "" {
		return corpusStub{Error: "empty path"}
	}
	entry, err := l.Get(ctx, req.OwnerID, corpusScopeOf(req), path)
	if err != nil {
		return corpusStub{Path: path, Error: peekErrText(err, path)}
	}
	return signatureFromEntry(&entry)
}

func peekErrText(err error, path string) string {
	switch {
	case errors.Is(err, ErrCorpusDenied):
		return "access denied: " + path
	case errors.Is(err, ErrCorpusNotFound):
		return "not found: " + path
	default:
		return "read failed: " + path
	}
}

// signatureFromEntry —— extract a node's signature from its entry (pure): tags + heading outline +
// [[outlinks]] + the first prose line, each bounded.
func signatureFromEntry(e *Entry) corpusStub {
	return corpusStub{
		Path: e.Path, Title: e.Title, Genre: e.Genre, Tags: e.Tags,
		Headings: extractHeadings(e.Body, peekMaxHeadings),
		Outlinks: extractOutlinkTargets(e.Body, peekMaxOutlinks),
		Lead:     LeadLine(e.Body, peekLeadMax),
	}
}
