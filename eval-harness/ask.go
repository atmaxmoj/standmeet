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
	// triggers the follow-up suggestions (ghost text) the way an access-code
	// session does in prod.
	Mode string `json:"mode"`
}

type askResponse struct {
	Answer string    `json:"answer"`
	Tools  []toolUse `json:"tools"`
	// Suggestions —— the 3 follow-up questions emitted at turn end in "code"
	// mode (empty in public mode).
	Suggestions []string `json:"suggestions,omitempty"`
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
	answer, tools, suggestions, aerr := askCandidate(context.Background(), log, cred, p, req)
	resp := askResponse{Answer: answer, Tools: tools, Suggestions: suggestions}
	if aerr != nil {
		resp.Error = aerr.Error()
	}
	if eerr := json.NewEncoder(os.Stdout).Encode(resp); eerr != nil {
		log.Error("encode ask response", "err", eerr)
		return 1
	}
	return 0
}

// askCandidate runs one candidate turn: the persona answers req.Question given
// the prior interview, on real DeepSeek, via the REAL visitor agent assembled by
// the facade (real prompt + real corpus/summarize/ask_visitor tools).
func askCandidate(
	ctx context.Context, log *slog.Logger, cred agentcore.Cred, p *persona, req askRequest,
) (string, []toolUse, []string, error) {
	mode := req.Mode
	if mode == "" {
		mode = "public"
	}
	// The interview-so-far feeds summarize_conversation: prior turns + the
	// question being answered, as the fixture transcript the facade exposes.
	convo := append(append([]convTurn{}, req.History...), convTurn{Role: "interviewer", Text: req.Question})
	override, oerr := systemPromptOverride()
	if oerr != nil {
		return "", nil, nil, oerr
	}
	agent, berr := agentcore.BuildVisitorAgent(ctx, &agentcore.BuildVisitorInput{
		Cred: &cred, OwnerID: evalOwnerID, Mode: mode, RoleBody: p.roleBody,
		Corpus: p.corpus, ConversationID: evalConvID,
		Conversation:         toConvMessages(convo),
		SystemPromptOverride: override,
	})
	if berr != nil {
		return "", nil, nil, berr
	}
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, UserMessage: req.Question, Model: cred.Model,
			History: candidateHistory(req.History),
		},
		Mode:           mode, // "code" → backend emits follow-up suggestions
		Tools:          agent.Tools,
		ProgressLabels: agent.Labels,
		ReturnDirectly: agent.ReturnDirectly,
	}
	sink := newCaptureSink()
	if err := agentcore.RunAgentLoop(ctx, log, in, sink); err != nil {
		return "", nil, nil, err
	}
	answer, used, ok := sink.result()
	if !ok {
		return answer, used, sink.followups(), fmt.Errorf("candidate turn: %s", sink.errorText())
	}
	return answer, used, sink.followups(), nil
}

// toConvMessages maps the interview-so-far into the facade's transcript shape
// (visitor / assistant) so summarize_conversation has a real conversation.
func toConvMessages(turns []convTurn) []agentcore.ConvMessage {
	out := make([]agentcore.ConvMessage, 0, len(turns))
	for _, t := range turns {
		role := "visitor"
		if t.Role == "candidate" {
			role = "assistant"
		}
		out = append(out, agentcore.ConvMessage{Role: role, Body: t.Text})
	}
	return out
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
