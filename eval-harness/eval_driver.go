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

	"github.com/atmaxmoj/standmeet/agentcore"
)

// EvalDriver —— canned environment for a standalone launch: owner persona + corpus,
// an optional granted skill (+ its canned stdout), an optional ext-mcp URL, and the
// LLM cred. Construct one per launch; it carries no shared state, so N can run in
// parallel (the prompt-experiment use case).
type EvalDriver struct {
	roleBody string
	corpus   []agentcore.VisitorCorpusEntry
	skill    *agentcore.VisitorSkillSpec
	mcpURL   string
	cred     agentcore.Cred
}

func (d *EvalDriver) Persona(_ context.Context) (agentcore.Persona, error) {
	return agentcore.Persona{RoleBody: d.roleBody, Corpus: d.corpus}, nil
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

func (d *EvalDriver) Resolve(_ context.Context) (agentcore.Cred, error) { return d.cred, nil }
