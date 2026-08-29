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

// evalOwnerName —— 这个 eval 实例背后的那个人。prod 从 owner 那一行取全名；eval 用这个常量。
// 它**不在语料里**（`corpusWithoutTheOwner`），所以任何一条答案里出现它，只可能来自 persona。
const evalOwnerName = "Sijie Wang"

// EvalDriver —— canned environment for a standalone launch: owner persona + corpus,
// an optional granted skill (+ its canned stdout), an optional ext-mcp URL, and the
// LLM cred. Construct one per launch; it carries no shared state, so N can run in
// parallel (the prompt-experiment use case).
type EvalDriver struct {
	// FailSearchFirst —— 头 N 次 corpus_search 直接报错,之后恢复。默认 0 = 从不报错。
	FailSearchFirst int
	searchCalls     int

	roleBody string
	corpus   []agentcore.VisitorCorpusEntry
	skill    *agentcore.VisitorSkillSpec
	mcpURL   string
	plugins  []agentcore.PluginSpec
	cred     agentcore.Cred
	// onceSkill —— 这个技能**只给一次**：第二次调用回一句「已经取过了」。
	//
	// 给 compaction 的工具腿用（bulkskill.go）。为什么必须这样：报告随手就能重读的话，
	// 摘要把实质丢了模型也能重跑一遍工具补回来 —— 于是「摘要带走了实质」和「压缩把它
	// 吃了」在答案上一模一样，判据不可能变红（真跑过：把任务书第 6 条整条删掉，那条腿
	// 照样绿）。一次性的外部报告（签名链接、过期报表）是真实存在的形状，而它正好让
	// 任务书自己那句话成立：**这份摘要是那份证据唯一能待的地方**。
	onceSkill  bool
	skillCalls int
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

// SearchCorpus —— 词级匹配,不是整条 query 当子串。
//
// 上一版是 `strings.Contains(title+body, wholeQuery)`,而那**两个方向都不像真的**,
// 并且它给的梯度是反的:正文里有 "Regulation is the core… A regulator holds…",
// 一个正常的查询 `regulation theory` 因为这两个词没连着出现 → 0 条,而偷懒的
// `regulator` → 命中。于是任何"agent 该不该把问题问得更具体"的实验,都会被这个
// 替身判成「越具体越差」。替身要按真索引的规矩答,再拿它去量产品。
//
// 规矩取两个真后端的公共部分:**按词切,一个词命中就算命中,词序无关**
// (Postgres FTS 和 Meili 都是这样)。CJK 不切词 —— 连续中文串按整串比,
// 这正是 Postgres 那条路的行为,也是这套语料上最保守的假设。
func (d *EvalDriver) SearchCorpus(_ context.Context, query string) ([]agentcore.CorpusHit, error) {
	// FailSearchFirst —— 前 N 次调用直接报错(默认 0 = 从不报错)。给「工具报错之后 agent
	// 会不会换路」那个探针用。做成 EvalDriver 自己的字段而不是包一层:launchCandidate
	// 硬绑 *EvalDriver,包出来的类型进不去。
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

// searchTerms —— 把查询切成词。空查询 → 空切片(调用方视作"全返")。
func searchTerms(query string) []string {
	return strings.FieldsFunc(strings.ToLower(strings.TrimSpace(query)), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r)
	})
}

// matchesAnyTerm —— 任一词命中即命中(OR)。真索引按相关度排序、不做 AND 过滤,
// 这里不排序,所以取 OR —— 宁可多给几条让 agent 自己分诊,那也是它手上有 corpus_peek 的原因。
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
