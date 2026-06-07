package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"

	"github.com/cloudwego/eino/components/tool"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// interview —— a simulated job interview between two LLMs:
//
//   - the interviewer: a recruiter/engineer asking real questions and following
//     up dynamically. Plain text generation, no tools.
//   - the candidate: the backend agentic loop (agentcore) answering AS the
//     owner, in the owner's voice, grounded in the owner's corpus via the
//     corpus_search/corpus_read tools.
//
// Both run through the SAME agentcore.RunAgentLoop — they differ only in system
// prompt, tools, and the role-mirrored history each is shown. The point is to
// observe the candidate's conversation quality over a long (30–60 min ≈ many
// turns) interview, not to assert pass/fail.
type interview struct {
	cred        agentcore.Cred
	corpus      *corpus
	role        string // the position being interviewed for
	maxExchange int
	out         io.Writer
	log         *slog.Logger
}

// turn —— one line of the canonical interview transcript.
type turn struct {
	speaker string // "interviewer" | "candidate"
	text    string
}

// run drives the interview to completion (maxExchange Q/A pairs or an early
// close from the interviewer), printing it as it goes.
func (iv *interview) run(ctx context.Context) error {
	candidateTools, candidateLabels := corpusToolset(iv.corpus)
	transcript := make([]turn, 0, iv.maxExchange*2)

	fmt.Fprintf(iv.out, "\n══════ INTERVIEW · %s ══════\n", iv.role)
	for i := 0; i < iv.maxExchange; i++ {
		q, err := iv.askInterviewer(ctx, transcript)
		if err != nil {
			return fmt.Errorf("interviewer turn %d: %w", i+1, err)
		}
		if q == "" {
			break
		}
		fmt.Fprintf(iv.out, "\n┌─ INTERVIEWER (Q%d)\n%s\n", i+1, indent(q))
		transcript = append(transcript, turn{speaker: "interviewer", text: q})
		if interviewClosed(q) {
			break
		}

		a, err := iv.askCandidate(ctx, transcript, candidateTools, candidateLabels)
		if err != nil {
			return fmt.Errorf("candidate turn %d: %w", i+1, err)
		}
		fmt.Fprintf(iv.out, "└─ CANDIDATE\n%s\n", indent(a))
		transcript = append(transcript, turn{speaker: "candidate", text: a})
	}
	fmt.Fprintf(iv.out, "\n══════ END (%d exchanges) ══════\n", len(transcript)/2)
	return nil
}

// interviewKickoff —— the synthetic opening user turn that elicits the
// interviewer's first question. The interviewer speaks first, but a chat must
// begin with a user message (eino rejects a leading assistant turn), so the
// interviewer's conversation always opens with this.
const interviewKickoff = "Begin the interview now: a brief greeting, then your first question."

// askInterviewer generates the next question. From the interviewer's point of
// view the conversation is: user(kickoff) → assistant(Q1) → user(A1) →
// assistant(Q2) → … so its own questions are assistant turns and the
// candidate's answers are user turns. The trailing user turn (the latest
// answer, or the kickoff on turn 1) is what it responds to.
func (iv *interview) askInterviewer(ctx context.Context, transcript []turn) (string, error) {
	msgs := make([]agentcore.ChatRequestMsg, 0, len(transcript)+1)
	msgs = append(msgs, agentcore.ChatRequestMsg{Role: "user", Content: interviewKickoff})
	for _, t := range transcript {
		role := "user"
		if t.speaker == "interviewer" {
			role = "assistant"
		}
		msgs = append(msgs, agentcore.ChatRequestMsg{Role: role, Content: t.text})
	}
	history, user := msgs[:len(msgs)-1], msgs[len(msgs)-1].Content
	in := &agentcore.AgentTurnInput{
		Cred: &iv.cred,
		Req: &agentcore.AgentTurnRequest{
			System: interviewerSystem(iv.role, iv.maxExchange), UserMessage: user,
			Model: iv.cred.Model, History: history,
		},
		Mode: "public",
	}
	sink := newCaptureSink(nil)
	if err := agentcore.RunAgentLoop(ctx, iv.log, in, sink); err != nil {
		return "", err
	}
	text, _, ok := sink.result()
	if !ok {
		return "", fmt.Errorf("interviewer sink: %s", sink.errorText())
	}
	return text, nil
}

// askCandidate answers via the agentic loop AS the owner, grounded in corpus.
// The candidate sees the interviewer as user and itself as assistant.
func (iv *interview) askCandidate(
	ctx context.Context, transcript []turn, tools []tool.BaseTool, labels map[string]string,
) (string, error) {
	history, user := mirrorFor("candidate", transcript)
	in := &agentcore.AgentTurnInput{
		Cred: &iv.cred,
		Req: &agentcore.AgentTurnRequest{
			System: candidateSystem(), UserMessage: user,
			Model: iv.cred.Model, History: history,
		},
		Mode:           "public",
		Tools:          tools,
		ProgressLabels: labels,
	}
	sink := newCaptureSink(iv.out) // echo tool usage so we see corpus consults
	if err := agentcore.RunAgentLoop(ctx, iv.log, in, sink); err != nil {
		return "", err
	}
	text, _, ok := sink.result()
	if !ok {
		return "", fmt.Errorf("candidate sink: %s", sink.errorText())
	}
	return text, nil
}

// mirrorFor maps the canonical transcript into (history, lastUserMessage) from
// the point of view of `me`: my own lines become assistant, the other party's
// become user. The trailing user line is split off as the current user_message
// (what the loop responds to). Returns user="" when there is nothing to respond
// to yet (interviewer's opening).
func mirrorFor(me string, transcript []turn) ([]agentcore.ChatRequestMsg, string) {
	msgs := make([]agentcore.ChatRequestMsg, 0, len(transcript))
	for _, t := range transcript {
		role := "user"
		if t.speaker == me {
			role = "assistant"
		}
		msgs = append(msgs, agentcore.ChatRequestMsg{Role: role, Content: t.text})
	}
	// The last message must be a user turn for the model to respond to; pop it.
	if n := len(msgs); n > 0 && msgs[n-1].Role == "user" {
		return msgs[:n-1], msgs[n-1].Content
	}
	return msgs, ""
}

// interviewEndToken —— the interviewer ends its final message with this exact
// token (instructed in interviewerSystem). We only look for it near the END of
// the message so it can't false-trigger mid-conversation — and so the mock
// gateway echoing the system prompt (which names the token) doesn't trip it.
const interviewEndToken = "[INTERVIEW_COMPLETE]"

func interviewClosed(q string) bool {
	q = strings.TrimSpace(q)
	tail := q
	if len(tail) > 80 {
		tail = tail[len(tail)-80:]
	}
	return strings.Contains(tail, interviewEndToken)
}

func indent(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i, l := range lines {
		lines[i] = "    " + l
	}
	return strings.Join(lines, "\n")
}
