// inference.go —— mock LLM scripting bridge. Tests script the next tool
// call OR the next text reply that backend's MockProvider should emit;
// backend polls + clears each single-slot queue before each agent step.
//
// Why HTTP between mock-LLM (in backend process) and this fixture: keeps
// the scripting state out of process-local backend memory (so multi-spec
// parallel runs don't bleed) and avoids dragging Redis into MockProvider.

package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"sync"
)

// scriptedTool —— the tool the mock LLM should call next. args is raw JSON fed
// straight into ExecuteTool(name, []byte).
type scriptedTool struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

// inferenceQueue —— single-slot queues (overwrite semantics; a later write
// overwrites an earlier one). Tests script only one tool / one reply at a time;
// the queue never backs up, keeping the behavior simple.
type inferenceQueue struct {
	queued      *scriptedTool
	queuedReply *string // used for the next turn's final text; nil = fallback INFERENCE_MOCK_REPLY
	mu          sync.Mutex
}

func (s *server) serveMockSetNextTool(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var t scriptedTool
	if uerr := json.Unmarshal(body, &t); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.inference.mu.Lock()
	s.inference.queued = &t
	s.inference.mu.Unlock()
	writeOK(s.log, w)
}

type takeNextToolResp struct {
	Tool *scriptedTool `json:"tool"`
}

func (s *server) serveMockTakeNextTool(w http.ResponseWriter, _ *http.Request) {
	s.inference.mu.Lock()
	out := s.inference.queued
	s.inference.queued = nil
	s.inference.mu.Unlock()
	writeTakeNextTool(s.log, w, takeNextToolResp{Tool: out})
}

func writeTakeNextTool(log *slog.Logger, w http.ResponseWriter, resp takeNextToolResp) {
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Warn("write take next tool", logErrKey, err)
	}
}

// scriptedReply —— the content the mock LLM streams out as the next turn's final
// text (G-X: lets a spec test real visitor-chat rendering of markdown / katex /
// mermaid content). Queued once -> backend takes it on the next stream -> cleared.
type scriptedReply struct {
	Text string `json:"text"`
}

func (s *server) serveMockSetNextReply(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}
	var p scriptedReply
	if uerr := json.Unmarshal(body, &p); uerr != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	s.inference.mu.Lock()
	s.inference.queuedReply = &p.Text
	s.inference.mu.Unlock()
	writeOK(s.log, w)
}

type takeNextReplyResp struct {
	Reply *scriptedReply `json:"reply"`
}

func (s *server) serveMockTakeNextReply(w http.ResponseWriter, _ *http.Request) {
	s.inference.mu.Lock()
	text := s.inference.queuedReply
	s.inference.queuedReply = nil
	s.inference.mu.Unlock()
	resp := takeNextReplyResp{}
	if text != nil {
		resp.Reply = &scriptedReply{Text: *text}
	}
	writeJSONHeader(w)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		s.log.Warn("write take next reply", logErrKey, err)
	}
}
