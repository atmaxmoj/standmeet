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
	// triggers the follow-up ghosts (ghost text) the way an access-code
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
	// MCP —— register an owner external MCP server (ext-mcp dials EVAL_MCP_URL for
	// real). Tests whether the agent invokes an owner-registered MCP tool. Needs a
	// running MCP server (the repo's mcp-server-mock: EVAL_MCP_URL=http://localhost:9100/mcp).
	MCP bool `json:"mcp"`
	// VisitorTimezone / OwnerTimezone —— #120: 把访客浏览器时区 + owner 日历时区锚进
	// 通用 instruction(instructionWithDateTime)。让 booking 用例能验"agent 按访客
	// 时区解释其给的时间、换算到 owner 日历时区"。空 → 退 UTC。
	VisitorTimezone string `json:"visitor_timezone"`
	OwnerTimezone   string `json:"owner_timezone"`
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
	// Ghosts —— the 3 follow-up questions emitted at turn end in "code"
	// mode (empty in public mode).
	Ghosts []string `json:"ghosts,omitempty"`
	// Report —— the summarize_conversation report HTML, when the candidate
	// summarized this turn (else empty). Lets the eval judge summary quality.
	Report string `json:"report,omitempty"`
	Error       string   `json:"error,omitempty"`
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
		Answer: turn.answer, Tools: turn.tools, Ghosts: turn.ghosts, Report: turn.report,
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
	ghosts []string
	report string
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
	// P.13: inject the canned environment through a Driver; the core launches the
	// real assembly behind it. (summarize/booker fixtures retired — those caps are
	// sandbox plugins now, not in the eval path.)
	agent, berr := agentcore.BuildVisitorAgent(ctx, &EvalDriver{
		roleBody: p.roleBody,
		corpus:   p.corpus,
		skill:    skillSpecFor(req),
		mcpURL:   mcpURLFor(req),
		cred:     cred,
	}, &agentcore.LaunchInput{
		OwnerID: evalOwnerID, Mode: mode, ConversationID: evalConvID,
		CodeID: evalCodeID, SystemPromptOverride: override,
	})
	if berr != nil {
		return candidateTurn{}, berr
	}
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, UserMessage: req.Question, Model: cred.Model,
			History: candidateHistory(req.History),
		},
		Mode:           mode, // "code" → backend emits follow-up ghosts
		Tools:          agent.Tools,
		ProgressLabels: agent.Labels,
		ReturnDirectly: agent.ReturnDirectly,
		// #120: 喂 owner + 访客时区进通用 instruction(instructionWithDateTime)。
		OwnerTimezone:   req.OwnerTimezone,
		VisitorTimezone: req.VisitorTimezone,
	}
	sink := newCaptureSink()
	if err := agentcore.RunAgentLoop(ctx, log, in, sink); err != nil {
		return candidateTurn{}, err
	}
	answer, used, ok := sink.result()
	turn := candidateTurn{
		answer: answer, tools: used, ghosts: sink.followups(), report: sink.reportHTML(),
	}
	if !ok {
		return turn, fmt.Errorf("candidate turn: %s", sink.errorText())
	}
	return turn, nil
}

// skillSpecFor returns the demo owner skill when the request asked for it.
func skillSpecFor(req askRequest) *agentcore.VisitorSkillSpec {
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
