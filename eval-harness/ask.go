package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// ask.go —— the candidate interface. This is what the eval-harness is FOR:
// expose the owner's agent (here "Marcus") as a callable "answer this question,
// given the interview so far" function, so an external interviewer — a Claude
// agent the operator spawns — can drive a multi-turn interview and judge the
// answers. The thing under test is the owner's REAL visitor agent — the prompt
// prod composes + the real corpus tools — assembled over this persona's fixture
// corpus by agentcore.BuildVisitorAgent. The harness just runs one candidate
// turn on real DeepSeek and reports the answer + tools it used.
//
// F.2: no more hand-assembled prompt / canned tools. BuildVisitorAgent drives
// the SAME capability assembly the HTTP path runs (RegisterVisitorSkills +
// AssembleVisitor + ComposeSystemPrompt) over fixture data — so prompt + tool
// fidelity is structural, not maintained-by-hand. The prompt stays injectable
// (EVAL_SYSTEM_PROMPT_FILE) so experiments can be tried and backfilled.
//
// Protocol: read an askRequest JSON on stdin, write an askResponse JSON on
// stdout. One process invocation = one candidate turn.

// evalOwnerID / evalConvID —— fixed identifiers for the single-owner eval run.
const (
	evalOwnerID = "marcus"
	evalConvID  = "eval-conv"
	evalCodeID  = "eval-code"
)

// persona —— the unit under test: the owner-voice role body (becomes the
// RoleSnapshot.PromptBody the facade frames the real prompt around) + the
// corpus the candidate answers from (fixture → real retrieval tools).
type persona struct {
	roleBody string
	corpus   []agentcore.VisitorCorpusEntry
}

func loadPersona(dir string) (*persona, error) {
	body, berr := os.ReadFile(filepath.Join(dir, "role-body.md"))
	if berr != nil {
		return nil, fmt.Errorf("read role-body.md: %w", berr)
	}
	c, cerr := loadCorpus(filepath.Join(dir, "corpus"))
	if cerr != nil {
		return nil, cerr
	}
	return &persona{roleBody: strings.TrimSpace(string(body)), corpus: toVisitorCorpus(c)}, nil
}

// systemPromptOverride —— the prompt-experiment injection point. When
// EVAL_SYSTEM_PROMPT_FILE points at a file, its contents REPLACE the composed
// prod prompt for this run — that's how "试出好 prompt → 回填 prod" works: try a
// variant here, compare, then backfill the winner into the prod fragments.
// Empty (the default) = the faithful prompt prod actually ships.
func systemPromptOverride() (string, error) {
	f := os.Getenv("EVAL_SYSTEM_PROMPT_FILE")
	if f == "" {
		return "", nil
	}
	b, err := os.ReadFile(f)
	if err != nil {
		return "", fmt.Errorf("EVAL_SYSTEM_PROMPT_FILE %s: %w", f, err)
	}
	return string(b), nil
}

// convTurn —— one prior line of the interview. role is "interviewer" or
// "candidate".
type convTurn struct {
	Role string `json:"role"`
	Text string `json:"text"`
}

type askRequest struct {
	History  []convTurn `json:"history"`
	Question string     `json:"question"`
	// Mode —— visitor mode: "public" (default) / "code" / "byoai". "code"
	// triggers the single steering ghost (P4 policy) the way an access-code
	// session does in prod.
	Mode string `json:"mode"`
	// Booking —— expose the real calendar_book + calendar_list_slots tools over a
	// canned calendar (connected, wide-open policy, slots free, insert succeeds).
	// Mirrors an access code that granted the booking skill, so it only takes
	// effect in "code" mode (prod hides the booker elsewhere). Leave false to test
	// permissions-deny: the booker is then structurally absent. EVAL_BOOKING_FAIL
	// ("notconnected" / "conflict") injects failure paths.
	Booking bool `json:"booking"`
	// Skill —— load a demo owner skill (skill-runner) so the agent gets a tool only
	// the owner could provide (roll_dice). Tests whether the agent discovers +
	// invokes an owner-curated skill. The canned sandbox returns a fixed roll.
	Skill bool `json:"skill"`
	// BulkSkill —— 换成那个**结果大到能顶过 32K 阈值**的技能（bulkskill.go）。
	// 给 compaction 用例的工具腿用：工具先跑，压缩才在工具结果已经进窗口之后触发。
	// 跟 Skill 互斥（一场只挂一个技能），它优先。
	BulkSkill bool `json:"bulk_skill"`
	// MCP —— register an owner external MCP server (ext-mcp dials EVAL_MCP_URL for
	// real). Tests whether the agent invokes an owner-registered MCP tool. Needs a
	// running MCP server (the repo's mcp-server-mock: EVAL_MCP_URL=http://localhost:9100/mcp).
	MCP bool `json:"mcp"`
	// Waypoints —— ghost steering: owner 在 role 上写的引导目的地,冻进这一场。
	// 给了就装 turn epilogue(跟 scenario runner 同一条:agentcore.BuildGhostPolicy);
	// 不给 = 这一场没有 waypoint,policy 短路成 silence —— 那正是"public 模式不出 ghost"
	// 该有的样子。
	Waypoints []askWaypoint `json:"waypoints"`
	// VisitorTimezone / OwnerTimezone —— #120: 把访客浏览器时区 + owner 日历时区锚进
	// 通用 instruction(instructionWithDateTime)。让 booking 用例能验"agent 按访客
	// 时区解释其给的时间、换算到 owner 日历时区"。空 → 退 UTC。
	VisitorTimezone string `json:"visitor_timezone"`
	OwnerTimezone   string `json:"owner_timezone"`
}

// askWaypoint —— 一个引导目的地(跟 scenario 那份同形;两处都翻成 agentcore.Waypoint)。
type askWaypoint struct {
	WaypointID   string   `json:"waypoint_id"`
	Description  string   `json:"description"`
	EvidenceRefs []string `json:"evidence_refs"`
	Weight       int      `json:"weight"`
	IsTerminal   bool     `json:"is_terminal"`
	Visited      bool     `json:"visited"`
}

// demoOwnerSkill —— a representative owner-curated skill: a tool the agent has no
// other way to satisfy (it can't roll a real die itself), so calling it is an
// unambiguous signal the agent discovered + used the owner skill.
func demoOwnerSkill() *agentcore.VisitorSkillSpec {
	return &agentcore.VisitorSkillSpec{
		Name:        "roll_dice",
		Description: "Roll an N-sided die and return the result. Use when the visitor asks you to roll a die.",
		Prompt:      "You have a roll_dice skill that rolls dice for the visitor. Use it when asked to roll.",
		Language:    "python",
		Content:     "import json,os,random; a=json.loads(os.environ.get('ARGS','{}')); print(json.dumps({'roll': random.randint(1, a.get('sides',6))}))",
		Stdout:      `{"roll": 4}`,
		Params: []agentcore.VisitorSkillParam{
			{Name: "sides", Type: "integer", Description: "number of sides on the die", Required: false},
		},
	}
}

type askResponse struct {
	Answer string    `json:"answer"`
	Tools  []toolUse `json:"tools"`
	// Report —— the summarize_conversation report HTML, when the candidate
	// summarized this turn (else empty). Lets the eval judge summary quality.
	Report string `json:"report,omitempty"`
	// Ghosts —— 本轮 epilogue 出的 steering ghost 文本(0 或 1 条:policy 一轮最多出一个)。
	// **不是 harness 自己编的**:它是 turn epilogue 真发出来的那一帧,跟 prod 走同一个
	// BuildGhostPolicy;没装 epilogue(无 waypoint / 非 code)自然是空。
	Ghosts []string `json:"ghosts"`
	Error  string   `json:"error,omitempty"`
}

// runAsk reads one askRequest from stdin and writes one askResponse. Exit code
// is non-zero only on a harness-level failure (bad input, build error); a
// model/tool error during the turn is reported in the response's Error field.
func runAsk(log *slog.Logger, cred agentcore.Cred, personaDir string) int {
	if personaDir == "" {
		log.Error("--ask requires --persona <dir>")
		return 2
	}
	var req askRequest
	if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
		log.Error("decode ask request", "err", err)
		return 2
	}
	p, err := loadPersona(personaDir)
	if err != nil {
		log.Error("load persona", "err", err)
		return 1
	}
	turn, aerr := askCandidate(context.Background(), log, cred, p, req)
	resp := askResponse{
		Answer: turn.answer, Tools: turn.tools, Report: turn.report,
		Ghosts: turn.ghosts,
	}
	if aerr != nil {
		resp.Error = aerr.Error()
	}
	if eerr := json.NewEncoder(os.Stdout).Encode(resp); eerr != nil {
		log.Error("encode ask response", "err", eerr)
		return 1
	}
	return 0
}

// candidateTurn —— one candidate turn's captured output. report is the
// summarize_conversation HTML when the candidate summarized (else "").
type candidateTurn struct {
	answer string
	tools  []toolUse
	report string
	ghosts []string
}

// askCandidate runs one candidate turn: the persona answers req.Question given
// the prior interview, on real DeepSeek, via the REAL visitor agent assembled by
// the facade (real prompt + real corpus/summarize/ask_visitor tools).
func askCandidate(
	ctx context.Context, log *slog.Logger, cred agentcore.Cred, p *persona, req askRequest,
) (candidateTurn, error) {
	mode := req.Mode
	if mode == "" {
		mode = "public"
	}
	override, oerr := systemPromptOverride()
	if oerr != nil {
		return candidateTurn{}, oerr
	}
	// P.13: inject the canned environment through a Driver; launchCandidate wires the corpus
	// tools LIVE (retrieval plugin + host socket) — the same one path every eval test uses, so
	// --ask actually has corpus_search/read/map/… instead of tools=0 (the old rot: no plugin
	// wired here → the model hallucinated with no corpus to read).
	driver := &EvalDriver{
		roleBody: p.roleBody,
		corpus:   p.corpus,
		skill:    skillSpecFor(req),
		mcpURL:   mcpURLFor(req),
		cred:     cred,
		// 那份大报告是**一次性**的：重读一遍就等于绕过了「摘要是证据唯一的家」这件事，
		// 而判据也就跟着不可能变红了（eval_driver.go 那段账）。
		onceSkill: req.BulkSkill,
	}
	failVerb, failMsg := bookingFailVerb()
	agent, cleanup, berr := launchCandidateWith(ctx, driver, &agentcore.LaunchInput{
		OwnerID: evalOwnerID, Mode: mode, ConversationID: evalConvID,
		CodeID: evalCodeID, SystemPromptOverride: override,
		// booking 是 acl=role_granted:只有**这一场的 role 授了它**才暴露。不授 = 结构性缺席,
		// 那正是 deny 用例要测的东西。
		GrantedCapabilities: grantedCapabilities(req),
	}, launchOpts{
		booking: req.Booking, bookingFail: failVerb, bookingFailMsg: failMsg,
		// owner.meta 说的时区必须跟 instruction 里那句是同一个 —— 预约策略(工作时间)按
		// owner 的时区判,两处不一致的话一个本该开着的时段会显示成关的。
		ownerTimezone: req.OwnerTimezone,
		// summarize 读的逐字稿 = 这一场到此为止说过的话(prod 从库里读同一份)。
		transcript: func() []agentcore.TranscriptTurn { return askTranscript(req) },
		report:     newReportBox().store,
	})
	if berr != nil {
		return candidateTurn{}, berr
	}
	defer cleanup()
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, UserMessage: req.Question, Model: cred.Model,
			History: candidateHistory(req.History),
		},
		Mode:           mode,
		Tools:          agent.Tools,
		ProgressLabels: agent.Labels,
		ReturnDirectly: agent.ReturnDirectly,
		// #120: 喂 owner + 访客时区进通用 instruction(instructionWithDateTime)。
		OwnerTimezone:   req.OwnerTimezone,
		VisitorTimezone: req.VisitorTimezone,
	}
	// ghost steering —— 跟 scenario runner 走**同一条**:BuildGhostPolicy(DB-free 的 policy
	// 闭包)包成通用 epilogue 帧。prod 那侧多的只有"落库 + 拿 ghost_id",跟判断无关。
	//
	// mode 不是 code、或者这一场没有 waypoint → 不装:那时 prod 也不装(hasFrozenWaypoints)。
	// 于是"public 模式不出 ghost"这条断言测的是**结构上没装**,不是 policy 恰好沉默了。
	attachGhostPolicy(in, cred, mode, req.Waypoints)
	sink := newCaptureSink()
	if err := agentcore.RunAgentLoop(ctx, log, in, sink); err != nil {
		return candidateTurn{}, err
	}
	answer, used, ok := sink.result()
	turn := candidateTurn{
		answer: answer, tools: used, report: sink.reportHTML(),
		ghosts: ghostTexts(sink.ghost),
	}
	if !ok {
		return turn, fmt.Errorf("candidate turn: %s", sink.errorText())
	}
	return turn, nil
}

// attachGhostPolicy —— code 模式 + 有 waypoint 才装 turn epilogue(prod 的
// hasFrozenWaypoints 同一个条件)。
func attachGhostPolicy(
	in *agentcore.AgentTurnInput, cred agentcore.Cred, mode string, wps []askWaypoint,
) {
	if mode != "code" || len(wps) == 0 {
		return
	}
	points, visited := askWaypoints(wps)
	in.Epilogue = func(ctx context.Context, lastMsg string) *agentcore.EpilogueFrame {
		return agentcore.GhostEpilogue(agentcore.BuildGhostPolicy(ctx, &cred, points, visited, lastMsg))
	}
}

// askWaypoints —— askWaypoint → BuildGhostPolicy 入参(waypoints + 已访问的 id)。
func askWaypoints(in []askWaypoint) ([]agentcore.Waypoint, []string) {
	points := make([]agentcore.Waypoint, 0, len(in))
	visited := make([]string, 0, len(in))
	for _, w := range in {
		points = append(points, agentcore.Waypoint{
			WaypointID: w.WaypointID, Description: w.Description,
			EvidenceRefs: w.EvidenceRefs, Weight: w.Weight, IsTerminal: w.IsTerminal,
		})
		if w.Visited {
			visited = append(visited, w.WaypointID)
		}
	}
	return points, visited
}

// ghostTexts —— 出来的那一帧 → 文本列表(nil = silence)。**永不为 nil**:空数组是
// "这一轮没出 ghost",null 会被读成"这个字段坏了"。
func ghostTexts(g *agentcore.GhostFrame) []string {
	if g == nil || g.Text == "" {
		return []string{}
	}
	return []string{g.Text}
}

// grantedCapabilities —— 这一场 role 授出去的能力 id。
func grantedCapabilities(req askRequest) []string {
	if !req.Booking {
		return []string{}
	}
	return []string{bookerCapabilityID}
}

// bookingFailVerb —— EVAL_BOOKING_FAIL 把某个连接器动词打成失败,用来跑"约不上"那几条路。
//   - "conflict"     → 插入被日历拒(那一刻被别人占了)
//   - "notconnected" → owner 根本没连日历,连查空闲都不行
//
// 连**错误话术**一起给:日历说"409 那个时段刚被占了"和日历说"出错了"是两条不同的路 ——
// 前者该改约,后者该重试。只说"拒绝了"的话,agent 只能瞎猜,而这条用例判的正是它选哪条。
func bookingFailVerb() (string, string) {
	switch os.Getenv("EVAL_BOOKING_FAIL") {
	case "conflict":
		return "calendar.insert_event",
			"409 conflict: that time was taken by another event while we were booking it"
	case "notconnected":
		return "calendar.free_busy", "no calendar is connected for this owner"
	default:
		return "", ""
	}
}

// skillSpecFor returns the demo owner skill when the request asked for it.
func skillSpecFor(req askRequest) *agentcore.VisitorSkillSpec {
	if req.BulkSkill {
		return dossierSkill()
	}
	if !req.Skill {
		return nil
	}
	return demoOwnerSkill()
}

// mcpURLFor returns the external MCP server URL when the request asked for it and
// EVAL_MCP_URL is set (empty otherwise → ext-mcp stays hidden).
func mcpURLFor(req askRequest) string {
	if !req.MCP {
		return ""
	}
	return os.Getenv("EVAL_MCP_URL")
}

// candidateHistory maps the interview-so-far into the candidate's chat history:
// the interviewer is the user, the candidate is the assistant. The new question
// is passed separately as the user_message, so history holds only completed
// turns and naturally begins with a user (interviewer) message.
func candidateHistory(prior []convTurn) []agentcore.ChatRequestMsg {
	if len(prior) == 0 {
		return nil
	}
	out := make([]agentcore.ChatRequestMsg, 0, len(prior))
	for _, t := range prior {
		role := "user"
		if t.Role == "candidate" {
			role = "assistant"
		}
		out = append(out, agentcore.ChatRequestMsg{Role: role, Content: t.Text})
	}
	return out
}

// askTranscript —— conversation.read 的答案:之前那些轮 + **这一轮的问题**。
//
// 最后那句必须在里面:让人总结的正是这一轮说的话,少了它总结出来的是上一轮的对话 ——
// 而那种偏差不报错,只是报告写得莫名其妙。角色用产品的词(visitor / assistant)。
func askTranscript(req askRequest) []agentcore.TranscriptTurn {
	out := make([]agentcore.TranscriptTurn, 0, len(req.History)+1)
	for _, t := range req.History {
		role := "visitor"
		if t.Role == "candidate" {
			role = "assistant"
		}
		out = append(out, agentcore.TranscriptTurn{Role: role, Body: t.Text})
	}
	return append(out, agentcore.TranscriptTurn{Role: "visitor", Body: req.Question})
}
