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
	"strings"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// evalOwnerName —— 这个 eval 实例背后的那个人。prod 从 owner 那一行取全名；eval 用这个常量。
// 它**不在语料里**（`corpusWithoutTheOwner`），所以任何一条答案里出现它，只可能来自 persona。
const evalOwnerName = "Sijie Wang"

// EvalDriver —— canned environment for a standalone launch: owner persona + corpus,
// an optional granted skill (+ its canned stdout), an optional ext-mcp URL, and the
// LLM cred. Construct one per launch; it carries no shared state, so N can run in
// parallel (the prompt-experiment use case).
type EvalDriver struct {
	roleBody string
	corpus   []agentcore.VisitorCorpusEntry
	skill    *agentcore.VisitorSkillSpec
	mcpURL   string
	plugins  []agentcore.PluginSpec
	cred     agentcore.Cred
}

// Persona —— owner 的名字跟语料**分开**给（UX-66）：prod 从 owner 那一行取，eval 从这里，
// 而两边都不是「碰巧检索到一条自我介绍」。留空只在专门验空名字那条用例里。
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

func (d *EvalDriver) SearchCorpus(_ context.Context, query string) ([]agentcore.CorpusHit, error) {
	q := strings.ToLower(strings.TrimSpace(query))
	hits := make([]agentcore.CorpusHit, 0, len(d.corpus))
	for i := range d.corpus {
		e := &d.corpus[i]
		if q != "" && !strings.Contains(strings.ToLower(e.Title+" "+e.Body), q) {
			continue
		}
		hits = append(hits, agentcore.CorpusHit{
			ID: e.Genre + "://" + e.Path, Path: e.Path, Title: e.Title,
			Genre: e.Genre, Snippet: corpusSnippet(e.Body),
		})
	}
	return hits, nil
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
