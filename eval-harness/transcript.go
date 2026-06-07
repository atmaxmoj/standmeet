package main

import (
	"encoding/json"
	"fmt"
	"io"
	"sync"
)

// transcriptSink —— AgentSink impl that renders each loop event as a human-
// readable transcript. It's the eval-side counterpart to prod's sseSink:
// same loop, a stdout transcript transport instead of pi SSE frames.
//
// Streamed assistant text is written inline as it arrives; structured events
// (tool start/complete, suggestions, done, error) print on their own marked
// line. A mutex guards interleaving since the loop may emit from a stream
// goroutine.
type transcriptSink struct {
	w     io.Writer
	mu    sync.Mutex
	atBOL bool // true when the cursor is at the start of a line
	// stats —— collected for the batch summary table.
	toolStarts int
	errored    bool
	stop       string
}

func newTranscriptSink(w io.Writer) *transcriptSink {
	return &transcriptSink{w: w, atBOL: true}
}

func (s *transcriptSink) Text(delta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.atBOL {
		fmt.Fprint(s.w, "ASSISTANT │ ")
	}
	fmt.Fprint(s.w, delta)
	s.atBOL = false
}

func (s *transcriptSink) ToolStarted(id, name, progressLabel string, args json.RawMessage) {
	s.mu.Lock()
	s.toolStarts++
	s.mu.Unlock()
	s.event("TOOL→     │ %s %s  (%s)", name, string(args), progressLabel)
}

func (s *transcriptSink) ToolCompleted(name, result string) {
	s.event("TOOL←     │ %s  ⇒ %s", name, result)
}

func (s *transcriptSink) Suggestions(items []string) {
	s.event("SUGGEST   │ %v", items)
}

func (s *transcriptSink) Error(err error) {
	s.mu.Lock()
	s.errored = true
	s.mu.Unlock()
	s.event("ERROR     │ %v", err)
}

func (s *transcriptSink) Done(stop string) {
	s.mu.Lock()
	s.stop = stop
	s.mu.Unlock()
	s.event("DONE      │ stop=%s", stop)
}

func (s *transcriptSink) fatal(err error) {
	s.event("FATAL     │ %v", err)
}

// event prints a structured line, first closing any open inline text line.
func (s *transcriptSink) event(format string, a ...any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.atBOL {
		fmt.Fprintln(s.w)
	}
	fmt.Fprintf(s.w, format+"\n", a...)
	s.atBOL = true
}
