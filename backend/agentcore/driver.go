// driver.go —— P.13 Bridge/Driver: the contract a standalone visitor-agent launch
// plugs its environment into. The agent core (BuildVisitorAgent) is the Abstraction;
// Driver is the Implementor. prod implements it over real systems; eval-harness over
// canned data — and crucially eval-harness is a SEPARATE go module, so every type on
// this interface is agentcore's OWN public DTO (zero internal/ leak). An implementer
// depends on this stable contract, not on backend internals — like a device driver
// against an OS API. (re-export of internal/ types would be dependency, not
// independence; this is the opposite.) That's what makes the core independently
// launchable: the same BuildVisitorAgent handle, any Driver behind it.
//
// Invariant: NO canned/fixture code lives in backend. The canned behaviour is the
// caller's Driver (eval-harness's EvalDriver); agentcore only has the bridge that
// adapts ANY Driver onto the real capreg assembly (bridge.go). check-no-mock guards
// that backend stays fixture-free. The plain-data DTOs are in dto.go.

package agentcore

import "context"

// Driver —— the environment a visitor-agent launch runs against. Methods are the
// external effects + data that vary by environment (persona/corpus, skill execution,
// owner-registered ext-mcp, LLM cred). The bridge wires each onto the real capability
// assembly; the agent never sees who's behind it (P.12 入口无关).
type Driver interface {
	// Persona —— the owner voice (RoleBody → composed prompt) + curated corpus the
	// visitor is grounded in (→ granted CorpusURIs on the role snapshot / ACL).
	Persona(ctx context.Context) (Persona, error)
	// Skill —— a granted owner skill (nil = none). Its metadata builds the skill tool;
	// its script executes via RunSkill.
	Skill(ctx context.Context) (*VisitorSkillSpec, error)
	// RunSkill —— execute the granted skill's script (the sandbox effect) and return
	// its stdout. prod runs a real sandbox; eval returns canned stdout.
	RunSkill(ctx context.Context, in SkillRun) (SkillResult, error)
	// ExtMCPURL —— an owner-registered external MCP server URL to dial for real
	// ("" = none granted). The dial itself stays real even in eval.
	ExtMCPURL(ctx context.Context) (string, error)
	// Plugins —— the externalized MCP-server plugins this launch should also assemble
	// (booker / retrieval / summarize / ask-visitor), as real binaries run over plain
	// stdio. Their host ops (corpus / booking / …) are reached over the socket paths in
	// each spec's Env, which the consumer backs with this same Driver. nil = none.
	Plugins(ctx context.Context) ([]PluginSpec, error)
	// SearchCorpus / ListCorpus / GetCorpus —— the corpus DATA the retrieval plugin reaches
	// over its host socket. ACL-free: return raw entries; the bridge applies the session's
	// granted-glob ACL. GetCorpus returns ErrCorpusNotFound for an unknown path.
	SearchCorpus(ctx context.Context, query string) ([]CorpusHit, error)
	ListCorpus(ctx context.Context, parentPath string, page int) ([]CorpusHit, error)
	GetCorpus(ctx context.Context, path string) (CorpusDoc, error)
	// Resolve —— the LLM cred the agent's own inference calls use.
	Resolve(ctx context.Context) (Cred, error)
}

// Persona —— owner voice + grounding corpus, plain data.
//
// OwnerName —— **谁**在说话。它跟语料**没有关系**，所以单独在这儿(UX-66)：以前身份只能靠
// 检索碰巧捞到一条介绍自己的笔记；公开切片收窄之后那条不在里面，于是这个 AI 会对着陌生人说
// 它不认识 owner。"用 owner 的声音回答"是个承诺，承诺得有机制兑现，不能靠副作用。
type Persona struct {
	OwnerName string
	RoleBody  string
	Corpus    []VisitorCorpusEntry
}

// SkillRun —— the RunSkill effect's input (the sandbox boundary), plain data so a
// separate module can implement it.
type SkillRun struct {
	Language string
	Script   string
	ArgsJSON string
}

// SkillResult —— the RunSkill effect's output.
type SkillResult struct {
	Stdout   string
	Stderr   string
	ExitCode int
}
