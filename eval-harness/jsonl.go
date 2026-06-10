package main

import (
	"encoding/json"
	"io"
	"sync"
)

// jsonEvent —— one JSONL line. A single struct with omitempty covers every
// line kind (scenario header, each loop event, summary); the Type field
// disambiguates. Machine-readable counterpart to the human transcript.
type jsonEvent struct {
	Type        string          `json:"type"`
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	System      string          `json:"system,omitempty"`
	User        string          `json:"user,omitempty"`
	Delta       string          `json:"delta,omitempty"`
	ID          string          `json:"id,omitempty"`
	Args        json.RawMessage `json:"args,omitempty"`
	Result      string          `json:"result,omitempty"`
	Label       string          `json:"label,omitempty"`
	Items       []string        `json:"items,omitempty"`
	Attempt     int             `json:"attempt,omitempty"`
	Stop        string          `json:"stop,omitempty"`
	Error       string          `json:"error,omitempty"`
	Scenarios   []summaryRow    `json:"scenarios,omitempty"`
	OK          bool            `json:"ok,omitempty"`
}

// summaryRow —— one scenario's tally inside the JSONL summary line.
type summaryRow struct {
	Name  string `json:"name"`
	Tools int    `json:"tools"`
	Stop  string `json:"stop"`
	OK    bool   `json:"ok"`
}

// writeJSONLine encodes one jsonEvent as a JSONL line (scenario header /
// summary, emitted by the formatter outside any sink).
func writeJSONLine(w io.Writer, e jsonEvent) {
	_ = json.NewEncoder(w).Encode(e)
}

// jsonlSink —— AgentSink that writes one JSON object per loop event. The
// json.Encoder appends a newline after each value, so the stream is valid
// JSONL.
type jsonlSink struct {
	mu         sync.Mutex
	enc        *json.Encoder
	toolStarts int
	errored    bool
	stop       string
}

func newJSONLSink(w io.Writer) *jsonlSink {
	return &jsonlSink{enc: json.NewEncoder(w)}
}

func (s *jsonlSink) Text(delta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.write(jsonEvent{Type: "text", Delta: delta})
}

func (s *jsonlSink) ToolStarted(id, name, progressLabel string, args json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.toolStarts++
	s.write(jsonEvent{Type: "tool_started", ID: id, Name: name, Label: progressLabel, Args: args})
}

func (s *jsonlSink) ToolCompleted(name, result string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.write(jsonEvent{Type: "tool_completed", Name: name, Result: result})
}

func (s *jsonlSink) Ghosts(items []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.write(jsonEvent{Type: "ghosts", Items: items})
}

func (s *jsonlSink) Retrying(attempt int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.write(jsonEvent{Type: "retrying", Attempt: attempt})
}

func (s *jsonlSink) Error(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.errored = true
	s.write(jsonEvent{Type: "error", Error: err.Error()})
}

func (s *jsonlSink) Done(stop string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stop = stop
	s.write(jsonEvent{Type: "done", Stop: stop})
}

func (s *jsonlSink) fatal(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.errored = true
	s.write(jsonEvent{Type: "fatal", Error: err.Error()})
}

func (s *jsonlSink) outcome() (int, bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.toolStarts, !s.errored, s.stop
}

// write encodes one line; caller holds the lock. Encode errors on stdout are
// not actionable, so they're dropped.
func (s *jsonlSink) write(e jsonEvent) {
	_ = s.enc.Encode(e)
}
