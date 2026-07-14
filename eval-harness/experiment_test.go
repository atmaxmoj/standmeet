// experiment_test.go —— the A/B measurement rig for harness-boundary changes (REAL model).
//
// Protocol (per the operator): changes land ONE AT A TIME; each candidate change is a config
// cell; every cell runs N times (single runs are noise); decisions come from the metric
// distribution, not from one lucky transcript. A change that looks right in theory can be a
// net loss in combination — the rig exists to catch exactly that.
//
// Shapes (the two observed exhaustion geometries of F-A-4):
//   - chain: sequential 33-note concept chain → forces a deep crawl (read → next → read).
//   - broad: many-topic vault + "survey everything" question → repeated wide searches.
//
// Metrics per run (written as JSONL to EVAL_RESULTS, default /tmp/harness-exp.jsonl):
//   tools, rounds, forced_final (the budget boundary fired), product/process text split
//   (process = text streamed in a round that ended with tool calls — the mechanical
//   gate-theory classifier), narration leak in the product, groundedness hits, denial of an
//   existing note (chain), wall seconds.
//
// Run: EVAL_SHAPE=chain|broad EVAL_RUNS=3 EVAL_CONFIG=baseline \
//        go test -run TestExperiment -count=1 -v -timeout 60m ./...

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// ---------- ordered sink: segments process vs product text ----------

// seqSink —— an AgentSink that keeps text in ORDER against tool events, so a run can be
// segmented mechanically: text streamed before a ToolStarted in the same round is PROCESS
// (the model kept working after saying it); only the text of the final, tool-less round —
// plus any forced-final synthesis — is PRODUCT. This is the gates-are-necessary-conditions
// classifier: in every successful trajectory the real answer is the tool-less tail.
type seqSink struct {
	mu       sync.Mutex
	segment  strings.Builder
	process  []string
	product  string
	tools    []toolUse
	rounds   int
	errored  bool
	errMsg   string
	lastTool bool // last event was ToolStarted (used to count rounds)
}

func (s *seqSink) Text(delta string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.segment.WriteString(delta)
	s.lastTool = false
}

func (s *seqSink) ToolStarted(_, name, _ string, args json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if seg := strings.TrimSpace(s.segment.String()); seg != "" {
		s.process = append(s.process, seg)
		s.segment.Reset()
	}
	if !s.lastTool {
		s.rounds++ // first tool of a round = the round's stream ended with tool calls
	}
	s.lastTool = true
	s.tools = append(s.tools, toolUse{Name: name, Args: string(args)})
}

func (s *seqSink) ToolCompleted(string, string) {}
func (s *seqSink) Ghost(*agentcore.GhostFrame)  {}
func (*seqSink) Retrying(int)                   {}

func (s *seqSink) Error(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.errored = true
	s.errMsg = err.Error()
}

func (s *seqSink) Done(string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.product = strings.TrimSpace(s.segment.String())
	s.segment.Reset()
}

// ---------- metrics ----------

type runMetrics struct {
	Shape         string  `json:"shape"`
	Config        string  `json:"config"`
	Run           int     `json:"run"`
	Tools         int     `json:"tools"`
	Rounds        int     `json:"rounds"`
	ForcedFinal   bool    `json:"forced_final"`
	ProductLen    int     `json:"product_len"`
	ProcessLen    int     `json:"process_len"`
	NarrationLeak bool    `json:"narration_leak"` // planning phrases inside the PRODUCT
	Grounded      int     `json:"grounded"`       // corpus-concept hits in the product
	DeniedNote    bool    `json:"denied_note"`    // claimed an existing note doesn't exist
	Errored       bool    `json:"errored"`
	Secs          float64 `json:"secs"`
	ProductHead   string  `json:"product_head"`
}

var planningRe = regexp.MustCompile(`(?i)^\s*(let me|i'll (check|search|pull|look)|let's (start|begin) by)`)

// narrationLeak —— the product opens like a plan, or is stitched planning lines.
func narrationLeak(product string) bool {
	if planningRe.MatchString(product) {
		return true
	}
	return strings.Count(strings.ToLower(product), "let me ") >= 3
}

// deniedExistingNote —— chain shape: the vault HAS photosynthesis; claiming otherwise is the
// harness-induced falsehood the evidence policy must prevent.
func deniedExistingNote(product string) bool {
	low := strings.ToLower(product)
	if !strings.Contains(low, "photosynthesis") {
		return false
	}
	for _, p := range []string{
		"don't have a", "do not have a", "couldn't find a", "could not find a",
		"no photosynthesis note", "isn't a photosynthesis", "is not a photosynthesis",
		"didn't turn one up", "didn't find a photosynthesis",
	} {
		if strings.Contains(low, p) {
			return true
		}
	}
	return false
}

func broadConceptHits(product string) int {
	low := strings.ToLower(product)
	hits := 0
	for _, c := range []string{
		"fermentation", "typography", "birding", "woodworking", "synthesizer",
		"cartography", "urban farming", "tea", "patience", "attention", "craft",
	} {
		if strings.Contains(low, c) {
			hits++
		}
	}
	return hits
}

// ---------- the run ----------

type expShape struct {
	name     string
	persona  string
	question string
	grounded func(string) int
}

func shapeByName(t *testing.T, name string) expShape {
	switch name {
	case "chain":
		return expShape{
			name:    "chain",
			persona: "fixtures/personas/chain-vault",
			question: "Start at your photosynthesis note and follow the chain link by link, " +
				"all the way to the end. Read every note in the chain. What is at the very " +
				"end of it, and what are the steps that get you there?",
			grounded: func(p string) int {
				if mentionsChainConcepts(p) {
					return 4
				}
				return 0
			},
		}
	case "broad":
		return expShape{
			name:    "broad",
			persona: "fixtures/personas/atlas-vault",
			question: "What are the recurring themes across ALL of your interests? Survey " +
				"everything — every topic you keep notes on — and pull the threads together.",
			grounded: broadConceptHits,
		}
	default:
		t.Fatalf("unknown EVAL_SHAPE %q (chain|broad)", name)
		return expShape{}
	}
}

func TestExperiment(t *testing.T) {
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("experiment rig needs a real LLM key; skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	shape := shapeByName(t, envOrDefault("EVAL_SHAPE", "chain"))
	runs := envInt("EVAL_RUNS", 3)
	config := envOrDefault("EVAL_CONFIG", "baseline")
	out := envOrDefault("EVAL_RESULTS", "/tmp/harness-exp.jsonl")

	p, perr := loadPersona(shape.persona)
	if perr != nil {
		t.Fatalf("load persona: %v", perr)
	}
	bin := buildHostPlugin(t, "../mcp-servers/retrieval")

	f, ferr := os.OpenFile(out, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if ferr != nil {
		t.Fatalf("open results: %v", ferr)
	}
	defer func() { _ = f.Close() }()

	for i := 1; i <= runs; i++ {
		m := oneExperimentRun(t, cred, p, shape, bin)
		m.Config, m.Run = config, i
		line, _ := json.Marshal(m)
		if _, werr := f.Write(append(line, '\n')); werr != nil {
			t.Fatalf("write results: %v", werr)
		}
		t.Logf("[%s/%s run %d] tools=%d rounds=%d forced=%v prodLen=%d procLen=%d "+
			"leak=%v grounded=%d denied=%v err=%v %.0fs\n  product: %.200s",
			shape.name, config, i, m.Tools, m.Rounds, m.ForcedFinal, m.ProductLen,
			m.ProcessLen, m.NarrationLeak, m.Grounded, m.DeniedNote, m.Errored, m.Secs,
			m.ProductHead)
	}
}

func oneExperimentRun(
	t *testing.T, cred agentcore.Cred, p *persona, shape expShape, pluginBin string,
) runMetrics {
	ctx := context.Background()
	sockDir, derr := os.MkdirTemp("/tmp", "smx")
	if derr != nil {
		t.Fatalf("sock dir: %v", derr)
	}
	defer func() { _ = os.RemoveAll(sockDir) }()
	sock := filepath.Join(sockDir, "r.sock")

	driver := &EvalDriver{
		cred: cred, roleBody: p.roleBody, corpus: p.corpus,
		plugins: []agentcore.PluginSpec{{
			ID: "corpus.retrieval", Command: pluginBin,
			Env:         map[string]string{"RETRIEVAL_SOCKET": sock},
			HostSockets: []string{sock}, RawToolNames: true, ACLAlways: true,
		}},
	}
	stop, serr := agentcore.StartRetrievalSocket(ctx, driver, sock)
	if serr != nil {
		t.Fatalf("StartRetrievalSocket: %v", serr)
	}
	defer func() { _ = stop() }()

	agent, err := agentcore.BuildVisitorAgent(ctx, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	if err != nil {
		t.Fatalf("BuildVisitorAgent: %v", err)
	}

	sink := &seqSink{}
	var logBuf strings.Builder
	log := slog.New(slog.NewTextHandler(&logBuf, nil))
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, Model: cred.Model, UserMessage: shape.question,
		},
		Mode: "public", Tools: agent.Tools,
		ProgressLabels: agent.Labels, ReturnDirectly: agent.ReturnDirectly,
	}
	start := time.Now()
	if rerr := agentcore.RunAgentLoop(ctx, log, in, sink); rerr != nil {
		t.Fatalf("RunAgentLoop: %v", rerr)
	}
	secs := time.Since(start).Seconds()

	sink.mu.Lock()
	defer sink.mu.Unlock()
	processLen := 0
	for _, s := range sink.process {
		processLen += len(s)
	}
	return runMetrics{
		Shape: shape.name, Tools: len(sink.tools), Rounds: sink.rounds,
		ForcedFinal:   strings.Contains(logBuf.String(), "forcing final answer"),
		ProductLen:    len(sink.product),
		ProcessLen:    processLen,
		NarrationLeak: narrationLeak(sink.product),
		Grounded:      shape.grounded(sink.product),
		DeniedNote:    shape.name == "chain" && deniedExistingNote(sink.product),
		Errored:       sink.errored,
		Secs:          secs,
		ProductHead:   fmt.Sprintf("%.300s", sink.product),
	}
}

func envOrDefault(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	v := os.Getenv(k)
	if v == "" {
		return def
	}
	var n int
	if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n < 1 {
		return def
	}
	return n
}
