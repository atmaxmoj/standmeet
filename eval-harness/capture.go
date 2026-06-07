package main

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
)

// captureSink —— an AgentSink that accumulates the assistant's full text for
// one turn (so the interview loop can record it into history) and optionally
// echoes tool activity to w (to show whether the candidate actually consulted
// the corpus). Unlike transcriptSink it does not print the answer text itself
// — the interview loop renders Q/A bodies in its own format.
type captureSink struct {
	mu      sync.Mutex
	echo    io.Writer // tool-activity echo target; nil = silent
	text    strings.Builder
	tools   []string
	errored bool
	errMsg  string
}

func newCaptureSink(echo io.Writer) *captureSink {
	return &captureSink{echo: echo}
}

func (s *captureSink) Text(delta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.text.WriteString(delta)
}

func (s *captureSink) ToolStarted(_, name, _ string, args json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.tools = append(s.tools, name)
	if s.echo != nil {
		fmt.Fprintf(s.echo, "            ┄ %s %s\n", name, string(args))
	}
}

func (s *captureSink) ToolCompleted(_, _ string) {}

func (s *captureSink) Suggestions(_ []string) {}

func (s *captureSink) Error(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.errored = true
	s.errMsg = err.Error()
	if s.echo != nil {
		fmt.Fprintf(s.echo, "            ┄ ERROR %v\n", err)
	}
}

func (s *captureSink) Done(_ string) {}

func (s *captureSink) result() (text string, tools []string, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.TrimSpace(s.text.String()), s.tools, !s.errored
}

func (s *captureSink) errorText() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.errMsg
}
