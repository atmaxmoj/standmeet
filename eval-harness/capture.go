package main

import (
	"encoding/json"
	"strings"
	"sync"
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
	mu          sync.Mutex
	text        strings.Builder
	tools       []toolUse
	suggestions []string
	errored     bool
	errMsg      string
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

func (s *captureSink) ToolCompleted(_, _ string) {}

func (s *captureSink) Suggestions(items []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.suggestions = items
}

// Retrying —— 重试只影响时延,不改最终 transcript;capture 只攒终态,no-op。
func (*captureSink) Retrying(int) {}

func (s *captureSink) followups() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.suggestions
}

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
