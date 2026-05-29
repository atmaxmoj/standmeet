// inference.go —— mock LLM scripting bridge. Tests script the next tool
// call the backend's MockProvider should issue; backend polls + clears
// the queue (one entry) before each agent step.
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

// scriptedTool —— mock LLM 下一步要调的 tool。args 是 raw JSON 给
// ExecuteTool(name, []byte) 直接喂。
type scriptedTool struct {
	Name string          `json:"name"`
	Args json.RawMessage `json:"args"`
}

// inferenceQueue —— single-slot queue (覆盖语义；后写覆盖前写)。tests
// 一次只 script 一个 tool；queue 不积压，行为简单。
type inferenceQueue struct {
	queued *scriptedTool
	mu     sync.Mutex
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
