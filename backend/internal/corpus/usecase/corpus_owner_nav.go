// corpus_owner_nav.go —— the corpus navigation the visitor tools already have (map / resolve /
// peek / grep / links), for the owner's own AI client.
//
// The owner face had eight flat corpus tools (create / get / list / search / update / delete /
// promote / check_i18n) and no map: an agent landing on the owner MCP could not see the shape of
// the corpus, filed a methodology note under subjectivity while wiki already had a
// `testing-software-3-0` tree for it, and could not find the canonical entry when search came back
// with no path (MCP navigation spec, 2026-10-06). These are the same runners the sandboxed
// retrieval block calls over its socket — one implementation, not a second one — run under the
// owner's scope. The scope goes through the runners' own ACL like any other, so the same ops can
// later serve a narrower face without a back door.

package usecase

import (
	"context"
	"encoding/json"

	access "github.com/atmaxmoj/standmeet/internal/access/facade"
)

// NavRun —— one navigation call on the owner's corpus.
type NavRun func(ctx context.Context, ownerID string, args json.RawMessage) (json.RawMessage, error)

// NavOp —— one navigation op for the owner face: its name (map / resolve / peek / grep / links),
// what the caller reads about it, its input schema, and the run.
type NavOp struct {
	Run         NavRun
	Name        string
	Description string
	Schema      json.RawMessage
}

// ownerNavScope —— everything the owner can read: every genre's glob, nothing withheld.
var ownerNavScope = access.CorpusScope{
	Granted: []string{
		"wiki://**", "output://**", "writing://**", "subjectivity://**", "raw://**",
	},
}

// OwnerNav —— the five navigation ops over the owner's corpus.
func OwnerNav(deps *IndexDeps) []NavOp {
	l := newPGLister(deps)
	return []NavOp{
		{Name: "map", Description: mapToolDesc, Schema: mapSchema, Run: ownerRun(l, runCorpusMap)},
		{
			Name: "resolve", Description: resolveToolDesc, Schema: resolveSchema,
			Run: ownerRun(l, runCorpusResolve),
		},
		{
			Name: "peek", Description: peekToolDesc, Schema: peekSchema,
			Run: ownerRun(l, runCorpusPeek),
		},
		{
			Name: "grep", Description: grepToolDesc, Schema: grepSchema,
			Run: ownerRun(l, runCorpusGrep),
		},
		{
			Name: "links", Description: linksToolDesc, Schema: linksSchema,
			Run: ownerRun(l, runCorpusLinks),
		},
	}
}

func ownerRun(l Lister, run corpusRunner) NavRun {
	return func(ctx context.Context, owner string, args json.RawMessage) (json.RawMessage, error) {
		req := &corpusIndexReq{OwnerID: owner, Args: args, CorpusScope: ownerNavScope}
		out, err := run(ctx, l, req)
		if err != nil {
			return nil, err
		}
		return json.RawMessage(out), nil
	}
}
