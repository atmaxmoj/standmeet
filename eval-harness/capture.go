package main

import (
	"encoding/json"
	"strings"
	"sync"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// toolUse —— one corpus tool the candidate invoked while answering, surfaced
// so an interviewer can see whether (and how) the candidate actually consulted
// the corpus rather than answering from thin air.
type toolUse struct {
	Name string `json:"name"`
	Args string `json:"args"`
}

// captureSink —— an AgentSink that accumulates the candidate's full answer text
// for one turn plus the corpus tools it called. Silent (no printing); the
// caller decides how to surface the captured answer.
type captureSink struct {
	mu    sync.Mutex
	text  strings.Builder
	tools []toolUse
	// ghost —— ghost-steering: 本轮 policy 出的单个 steering ghost(nil = silence)。
	// eval-ghost 拿它的 target_waypoint 对 gold。
	ghost *agentcore.GhostFrame
	// report —— summarize_conversation is a ReturnDirectly tool with no text
	// answer; the report HTML lives only in its tool result. Capture it so the
	// eval can judge how good the generated summary is.
	report  string
	errored bool
	errMsg  string
}

func newCaptureSink() *captureSink { return &captureSink{} }

func (s *captureSink) Text(delta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.text.WriteString(delta)
}

func (s *captureSink) ToolStarted(_, name, _ string, args json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tools = append(s.tools, toolUse{Name: name, Args: string(args)})
}

// ToolCompleted —— most tool results are surfaced via ToolStarted (name+args);
// summarize_conversation is the exception: its report HTML is only in the
// result, and (being ReturnDirectly) there is no text answer to carry it. Pull
// the html out so the eval can judge the summary.
func (s *captureSink) ToolCompleted(name, result string) {
	if name != "summarize_conversation" {
		return
	}
	var wire struct {
		HTML string `json:"html"`
	}
	if err := json.Unmarshal([]byte(result), &wire); err != nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.report = wire.HTML
}

// Epilogue —— generic post-done frame. Ghost steering is Kind="ghost"; parse it back to the typed
// GhostFrame for gold (other kinds ignored — the eval only golds ghosts).
func (s *captureSink) Epilogue(f *agentcore.EpilogueFrame) {
	g := agentcore.ParseGhostEpilogue(f)
	if g == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ghost = g
}

// Retrying —— 重试只影响时延,不改最终 transcript;capture 只攒终态,no-op。
func (*captureSink) Retrying(int) {}

func (s *captureSink) Error(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.errored = true
	s.errMsg = err.Error()
}

func (s *captureSink) Done(_ string) {}

func (s *captureSink) result() (text string, tools []toolUse, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.tools == nil {
		s.tools = []toolUse{}
	}
	return strings.TrimSpace(s.text.String()), s.tools, !s.errored
}

func (s *captureSink) errorText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.errMsg
}

// reportHTML —— the summarize_conversation report body captured this turn, or
// "" if the candidate didn't summarize.
func (s *captureSink) reportHTML() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.report
}
