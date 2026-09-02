// eval_driver.go —— P.13 ConcreteImplementor: the canned agentcore.Driver. ALL of the
// eval's test-double behaviour lives HERE, in eval-harness, and is injected into the
// agent core through the public Launch handle — backend carries zero fixtures. It
// implements agentcore.Driver purely over agentcore's public DTOs, so this separate
// go module needs no backend internals (that's the independence: it depends on the
// core's contract, not on internal/).
//
// Canned behaviour: RunSkill returns the skill's fixed Stdout (no real sandbox); the
// ext-mcp dial stays REAL (URL handed through) since that's a true transport boundary.

package main

import (
	"context"
	"fmt"
	"strings"
	"unicode"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// evalOwnerName —— the person behind this eval instance. Prod pulls the full name from the
// owner row; eval uses this constant instead.
// It **is not in the corpus** (`corpusWithoutTheOwner`), so if it shows up in any answer, it can
// only have come from the persona.
const evalOwnerName = "Sijie Wang"

// EvalDriver —— canned environment for a standalone launch: owner persona + corpus,
// an optional granted skill (+ its canned stdout), an optional ext-mcp URL, and the
// LLM cred. Construct one per launch; it carries no shared state, so N can run in
// parallel (the prompt-experiment use case).
type EvalDriver struct {
	// FailSearchFirst —— the first N corpus_search calls fail outright, then it recovers. Default 0 = never fails.
	FailSearchFirst int
	searchCalls     int

	roleBody string
	corpus   []agentcore.VisitorCorpusEntry
	skill    *agentcore.VisitorSkillSpec
	mcpURL   string
	plugins  []agentcore.PluginSpec
	cred     agentcore.Cred
	// onceSkill —— this skill is **granted only once**: a second call gets back "already fetched."
	//
	// Used by compaction's tool leg (bulkskill.go). Why this has to be the case: if the report
	// could just be re-read on a whim, then even after the summary drops the substance, the
	// model could re-run the tool and get it back — so "the summary carried the substance away"
	// and "compaction ate it" would look identical in the answer, and the check could never go
	// red (verified this for real: deleting item 6 of the task sheet outright, that leg still
	// stayed green). A one-time external report (a signed link, an expiring report) is a shape
	// that genuinely exists, and it's exactly what makes the task sheet's own claim true:
	// **this summary is the only place that evidence can still live.**
	onceSkill  bool
	skillCalls int
}

// Persona —— the owner's name is given **separately** from the corpus (UX-66): prod pulls it
// from the owner row, eval pulls it from here, and neither side is "happened to retrieve a
// self-introduction note." Left empty only in the use case that specifically tests an empty name.
func (d *EvalDriver) Persona(_ context.Context) (agentcore.Persona, error) {
	return agentcore.Persona{
		OwnerName: evalOwnerName, RoleBody: d.roleBody, Corpus: d.corpus,
	}, nil
}

func (d *EvalDriver) Skill(_ context.Context) (*agentcore.VisitorSkillSpec, error) {
	return d.skill, nil
}

// RunSkill —— canned: return the granted skill's fixed Stdout. A real sandbox would
// execute in.Script; the eval only needs a deterministic output to drive the agent.
func (d *EvalDriver) RunSkill(_ context.Context, _ agentcore.SkillRun) (agentcore.SkillResult, error) {
	if d.skill == nil {
		return agentcore.SkillResult{}, nil
	}
	d.skillCalls++
	if d.onceSkill && d.skillCalls > 1 {
		return agentcore.SkillResult{Stdout: onceSpentStdout}, nil
	}
	return agentcore.SkillResult{Stdout: d.skill.Stdout}, nil
}

func (d *EvalDriver) ExtMCPURL(_ context.Context) (string, error) { return d.mcpURL, nil }

// Plugins —— the externalized plugins this launch assembles (host-built MCP-server
// binaries, plain stdio). Their host-op sockets (corpus / booking / …) are backed by
// this same EvalDriver via the host-socket servers the harness runs.
func (d *EvalDriver) Plugins(_ context.Context) ([]agentcore.PluginSpec, error) {
	return d.plugins, nil
}

func (d *EvalDriver) Resolve(_ context.Context) (agentcore.Cred, error) { return d.cred, nil }

// SearchCorpus / ListCorpus / GetCorpus —— the corpus data the retrieval plugin reaches
// over its host socket. ACL-free in-memory ops over the persona corpus (incl. private
// entries); the agentcore bridge applies the granted-glob ACL, so privacy still holds.

// SearchCorpus —— term-level matching, not the whole query as one substring.
//
// The previous version was `strings.Contains(title+body, wholeQuery)`, and **neither direction
// of that felt real**: the gradient it gave was backwards. With body text like "Regulation is
// the core… A regulator holds…", a normal query `regulation theory` gets 0 hits because the two
// words never appear adjacent, while the lazy `regulator` gets a hit. So any experiment about
// "should the agent ask a more specific question" would get judged by this stand-in as
// "more specific is worse." The stand-in needs to follow the rules a real index follows, and
// only then can it be used to measure the product.
//
// The rule takes the common ground between the two real backends: **split by term, any term
// match counts as a hit, word order doesn't matter** (both Postgres FTS and Meili work this
// way). CJK isn't tokenized — a contiguous CJK run is compared as a whole string, which is
// exactly the Postgres path's behavior, and the most conservative assumption on this corpus.
func (d *EvalDriver) SearchCorpus(_ context.Context, query string) ([]agentcore.CorpusHit, error) {
	// FailSearchFirst —— the first N calls fail outright (default 0 = never fails). Used by the
	// probe for "does the agent switch paths after a tool errors." Made a field of EvalDriver
	// itself rather than a wrapper: launchCandidate is hard-bound to *EvalDriver, so a wrapped
	// type couldn't be passed through.
	d.searchCalls++
	if d.searchCalls <= d.FailSearchFirst {
		return nil, fmt.Errorf("search backend unavailable (attempt %d)", d.searchCalls)
	}
	terms := searchTerms(query)
	hits := make([]agentcore.CorpusHit, 0, len(d.corpus))
	for i := range d.corpus {
		e := &d.corpus[i]
		if !matchesAnyTerm(strings.ToLower(e.Title+" "+e.Body), terms) {
			continue
		}
		hits = append(hits, agentcore.CorpusHit{
			ID: e.Genre + "://" + e.Path, Path: e.Path, Title: e.Title,
			Genre: e.Genre, Snippet: corpusSnippet(e.Body),
		})
	}
	return hits, nil
}

// searchTerms —— splits the query into terms. An empty query → an empty slice (the caller treats this as "return everything").
func searchTerms(query string) []string {
	return strings.FieldsFunc(strings.ToLower(strings.TrimSpace(query)), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}

// matchesAnyTerm —— any term matching counts as a hit (OR). A real index ranks by relevance and
// doesn't AND-filter; this doesn't rank either, so it takes OR — better to over-return and let
// the agent triage itself, which is exactly why it has corpus_peek in hand.
func matchesAnyTerm(hay string, terms []string) bool {
	if len(terms) == 0 {
		return true
	}
	for _, t := range terms {
		if strings.Contains(hay, t) {
			return true
		}
	}
	return false
}

func (d *EvalDriver) ListCorpus(_ context.Context, parentPath string, _ int) ([]agentcore.CorpusHit, error) {
	hits := make([]agentcore.CorpusHit, 0, len(d.corpus))
	for i := range d.corpus {
		e := &d.corpus[i]
		if !corpusUnder(e.Path, parentPath) {
			continue
		}
		hits = append(hits, agentcore.CorpusHit{
			ID: e.Genre + "://" + e.Path, Path: e.Path, Title: e.Title, Genre: e.Genre,
		})
	}
	return hits, nil
}

func (d *EvalDriver) GetCorpus(_ context.Context, path string) (agentcore.CorpusDoc, error) {
	for i := range d.corpus {
		e := &d.corpus[i]
		if e.Path == path {
			return agentcore.CorpusDoc{
				ID: e.Genre + "://" + e.Path, Path: e.Path, Title: e.Title,
				Genre: e.Genre, Body: e.Body,
			}, nil
		}
	}
	return agentcore.CorpusDoc{}, agentcore.ErrCorpusNotFound
}

// corpusSnippet —— first ~160 chars of body, trimmed.
func corpusSnippet(body string) string {
	trimmed := strings.TrimSpace(body)
	if len(trimmed) <= 160 {
		return trimmed
	}
	return trimmed[:160] + "…"
}

// corpusUnder —— is path a direct-ish child of parentPath? "" = roots (no slash).
func corpusUnder(path, parentPath string) bool {
	if parentPath == "" {
		return !strings.Contains(path, "/")
	}
	return strings.HasPrefix(path, parentPath+"/")
}
