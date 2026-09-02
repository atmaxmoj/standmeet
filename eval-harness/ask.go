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
// prod prompt for this run — that's how "try a prompt here → backfill the winner into prod" works: try a
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
	// BulkSkill —— swaps in the skill whose **result is large enough to clear the 32K
	// threshold** (bulkskill.go). Used by the compaction test case's tool leg: the tool
	// runs first, and compaction only fires once the tool result is already in the window.
	// Mutually exclusive with Skill (one run mounts only one skill); this one wins.
	BulkSkill bool `json:"bulk_skill"`
	// MCP —— register an owner external MCP server (ext-mcp dials EVAL_MCP_URL for
	// real). Tests whether the agent invokes an owner-registered MCP tool. Needs a
	// running MCP server (the repo's mcp-server-mock: EVAL_MCP_URL=http://localhost:9100/mcp).
	MCP bool `json:"mcp"`
	// Waypoints —— ghost steering: the guidance destinations the owner wrote on the role,
	// frozen for this run. Given → mounts the turn epilogue (same path as the scenario
	// runner: agentcore.BuildGhostPolicy); not given = this run has no waypoints, the
	// policy short-circuits to silence —— exactly what "public mode never emits a ghost"
	// should look like.
	Waypoints []askWaypoint `json:"waypoints"`
	// VisitorTimezone / OwnerTimezone —— #120: anchors the visitor's browser timezone +
	// the owner's calendar timezone into the shared instruction (instructionWithDateTime).
	// Lets booking test cases verify "the agent interprets the visitor's given time in the
	// visitor's timezone, then converts it to the owner's calendar timezone." Empty → falls
	// back to UTC.
	VisitorTimezone string `json:"visitor_timezone"`
	OwnerTimezone   string `json:"owner_timezone"`
}

// askWaypoint —— one guidance destination (same shape as the scenario one; both translate
// into agentcore.Waypoint).
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
	// Ghosts —— the steering ghost text this turn's epilogue emitted (0 or 1 entry: the
	// policy emits at most one per turn). **Not the harness making it up**: it's the frame
	// the turn epilogue actually emitted, going through the same BuildGhostPolicy as prod;
	// with no epilogue mounted (no waypoint / not code mode) it's naturally empty.
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
		// The big report is **one-shot**: reading it again would sidestep "the summary is
		// the sole home of the evidence," and the assertion could then never go red
		// (see the write-up in eval_driver.go).
		onceSkill: req.BulkSkill,
	}
	failVerb, failMsg := bookingFailVerb()
	agent, cleanup, berr := launchCandidateWith(ctx, driver, &agentcore.LaunchInput{
		OwnerID: evalOwnerID, Mode: mode, ConversationID: evalConvID,
		CodeID: evalCodeID, SystemPromptOverride: override,
		// booking is acl=role_granted: it's exposed only when **this run's role granted
		// it**. Not granted = structural absence, exactly what the deny test case checks.
		GrantedCapabilities: grantedCapabilities(req),
	}, launchOpts{
		booking: req.Booking, bookingFail: failVerb, bookingFailMsg: failMsg,
		// The timezone in owner.meta must be the same one that's in the instruction ——
		// the booking policy (working hours) is judged against the owner's timezone, and
		// a mismatch between the two would show an otherwise-open slot as closed.
		ownerTimezone: req.OwnerTimezone,
		// The transcript summarize reads = everything said in this run so far (prod reads
		// the same thing from the DB).
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
		// #120: feeds owner + visitor timezone into the shared instruction (instructionWithDateTime).
		OwnerTimezone:   req.OwnerTimezone,
		VisitorTimezone: req.VisitorTimezone,
	}
	// ghost steering —— goes through the **same path** as the scenario runner:
	// BuildGhostPolicy (a DB-free policy closure) wrapped into the shared epilogue frame.
	// The only extra thing on the prod side is "persist to DB + get a ghost_id," which is
	// irrelevant to the assertion.
	//
	// mode isn't code, or this run has no waypoints → don't mount it: prod doesn't mount it
	// there either (hasFrozenWaypoints). So the "public mode never emits a ghost" assertion
	// tests **it was never mounted structurally**, not that the policy happened to stay quiet.
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

// attachGhostPolicy —— mounts the turn epilogue only in code mode + with waypoints present
// (same condition as prod's hasFrozenWaypoints).
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

// askWaypoints —— askWaypoint → BuildGhostPolicy inputs (waypoints + the ids already visited).
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

// ghostTexts —— the emitted frame → a text list (nil = silence). **Never nil**: an empty
// array means "this turn emitted no ghost," while null would be read as "this field is broken."
func ghostTexts(g *agentcore.GhostFrame) []string {
	if g == nil || g.Text == "" {
		return []string{}
	}
	return []string{g.Text}
}

// grantedCapabilities —— the capability ids this run's role granted.
func grantedCapabilities(req askRequest) []string {
	if !req.Booking {
		return []string{}
	}
	return []string{bookerCapabilityID}
}

// bookingFailVerb —— EVAL_BOOKING_FAIL forces a connector verb to fail, to run the
// "can't book" paths.
//   - "conflict"     → the insert is rejected by the calendar (someone else took the slot
//     right then)
//   - "notconnected" → the owner has no calendar connected at all, not even a free/busy check
//
// Ships the **exact wording** too: the calendar saying "409, that slot was just taken" and
// the calendar saying "something went wrong" are two different paths —— the former should
// prompt a re-booking, the latter a retry. Given only "it was rejected," the agent can only
// guess, and this test case judges exactly which one it picks.
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

// askTranscript —— what conversation.read answers: the prior turns + **this turn's
// question**.
//
// That last line must be in there: what gets summarized is what was said in this turn, and
// without it the summary would cover the prior turn instead —— a mismatch that doesn't
// error, it just makes the report read strangely. Roles use the product's vocabulary
// (visitor / assistant).
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
