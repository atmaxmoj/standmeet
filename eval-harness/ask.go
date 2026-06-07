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
// answers. The thing under test is the owner's system prompt (persona
// system.md) + corpus grounding; the harness just runs one candidate turn on
// real DeepSeek and reports the answer + which corpus entries it consulted.
//
// Protocol: read an askRequest JSON on stdin, write an askResponse JSON on
// stdout. One process invocation = one candidate turn.

// persona —— the unit under test: the owner-voice system prompt + the corpus
// the candidate answers from.
type persona struct {
	system string
	corpus *corpus
}

func loadPersona(dir string) (*persona, error) {
	sys, err := os.ReadFile(filepath.Join(dir, "system.md"))
	if err != nil {
		return nil, fmt.Errorf("persona system.md: %w", err)
	}
	c, cerr := loadCorpus(filepath.Join(dir, "corpus"))
	if cerr != nil {
		return nil, cerr
	}
	return &persona{system: strings.TrimSpace(string(sys)), corpus: c}, nil
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
}

type askResponse struct {
	Answer string    `json:"answer"`
	Tools  []toolUse `json:"tools"`
	Error  string    `json:"error,omitempty"`
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
	answer, tools, aerr := askCandidate(context.Background(), log, cred, p, req)
	resp := askResponse{Answer: answer, Tools: tools}
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
// the prior interview, on real DeepSeek, grounded via the corpus tools.
func askCandidate(
	ctx context.Context, log *slog.Logger, cred agentcore.Cred, p *persona, req askRequest,
) (string, []toolUse, error) {
	// Full visitor toolset (corpus + built-ins). summarize_conversation needs
	// the interview so far: prior turns + the question being answered.
	convo := append(append([]convTurn{}, req.History...), convTurn{Role: "interviewer", Text: req.Question})
	tools, labels, returnDirectly := personaToolset(p.corpus, cred, convo)
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: p.system, UserMessage: req.Question, Model: cred.Model,
			History: candidateHistory(req.History),
		},
		Mode:           "public",
		Tools:          tools,
		ProgressLabels: labels,
		ReturnDirectly: returnDirectly,
	}
	sink := newCaptureSink()
	if err := agentcore.RunAgentLoop(ctx, log, in, sink); err != nil {
		return "", nil, err
	}
	answer, used, ok := sink.result()
	if !ok {
		return answer, used, fmt.Errorf("candidate turn: %s", sink.errorText())
	}
	return answer, used, nil
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
