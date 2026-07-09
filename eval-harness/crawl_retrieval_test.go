// crawl_retrieval_test.go —— link/crawl retrieval eval (deterministic, no LLM).
//
// The owner's vault is a knowledge GRAPH: notes reference each other with [[wikilinks]] (220/222 of
// the real vault). Answering often needs a multi-hop CRAWL: search finds note A, but the fact lives in
// note B that A links to. This eval asserts the crawl chain works end-to-end over the REAL retrieval
// plugin against a Driver corpus (no postgres, no bwrap — same wiring as retrieval_assembly_test.go):
//
//	corpus_search("regulation theory") → theory (A)
//	corpus_read(theory)                → body carries [[good-regulator-theorem]]
//	corpus_links(theory)               → OUTGOING includes good-regulator-theorem (B)   ← the new Links()
//	corpus_read(good-regulator-theorem)→ the fact only B holds (GRT_MARKER)
//	corpus_links(good-regulator-...)   → BACKLINKS includes theory (reverse edge)
//
// Without a working corpus_links (it was a stub returning empty), a links-driven crawl silently dead-ends.
// This pins both directions of the graph edge.

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// linkedCorpus —— a tiny cybernetics graph modelled on the real vault: theory → good-regulator-theorem.
// The answer-bearing fact (GRT_MARKER) lives ONLY in B; A merely links to it.
func linkedCorpus() []agentcore.VisitorCorpusEntry {
	return []agentcore.VisitorCorpusEntry{
		{
			Genre: "wiki", Path: "cybernetics/theory/theory", Title: "Control & regulation theory",
			Body: "Regulation is the core of cybernetics. A regulator holds an essential variable " +
				"within bounds against disturbance. The deep result here is [[good-regulator-theorem]] — " +
				"see also [[ashby]] on requisite variety.",
		},
		{
			Genre: "wiki", Path: "cybernetics/theory/good-regulator-theorem", Title: "Good regulator theorem",
			Body: "Every good regulator of a system must be a model of that system (Conant & Ashby, 1970). " +
				"GRT_MARKER: to regulate X well, you must embody a model of X. This is the fact a crawl must reach.",
		},
		{
			Genre: "wiki", Path: "cybernetics/theory/ashby", Title: "Ashby",
			Body: "W. Ross Ashby: requisite variety — only variety can absorb variety.",
		},
	}
}

func TestCrawlRetrieval_LinksDrivenMultiHop(t *testing.T) {
	ctx := context.Background()
	bin := buildHostPlugin(t, "../mcp-servers/retrieval")
	sockDir, derr := os.MkdirTemp("/tmp", "smc")
	if derr != nil {
		t.Fatalf("sock dir: %v", derr)
	}
	defer func() { _ = os.RemoveAll(sockDir) }()
	sock := filepath.Join(sockDir, "r.sock")

	driver := &EvalDriver{
		cred:   evalCred(),
		corpus: linkedCorpus(),
		plugins: []agentcore.PluginSpec{{
			ID: "corpus.retrieval", Command: bin,
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
	names := agentToolNames(t, agent)
	for _, want := range []string{"corpus_search", "corpus_read", "corpus_links"} {
		if !contains(names, want) {
			t.Fatalf("%s not assembled; tools=%v", want, names)
		}
	}

	// Hop 1: search finds A (theory) — NOT the fact yet.
	search := invokeTool(t, agent, "corpus_search", `{"query":"regulation theory"}`)
	if !strings.Contains(search, "cybernetics/theory/theory") {
		t.Fatalf("search didn't surface the theory note; got: %s", search)
	}
	if strings.Contains(search, "GRT_MARKER") {
		t.Fatalf("the answer-bearing fact should NOT be reachable by search alone; got: %s", search)
	}

	// Hop 2: read A → its body links to B.
	readA := invokeTool(t, agent, "corpus_read", `{"path":"cybernetics/theory/theory"}`)
	if !strings.Contains(readA, "good-regulator-theorem") {
		t.Fatalf("read(theory) should carry the [[good-regulator-theorem]] link; got: %s", readA)
	}

	// Hop 3: corpus_links(A) → OUTGOING resolves the [[link]] to B (this is the new Links()).
	links := invokeTool(t, agent, "corpus_links", `{"path":"cybernetics/theory/theory"}`)
	outgoing, _, ok := strings.Cut(links, `"backlinks"`)
	if !ok {
		t.Fatalf("corpus_links wire missing backlinks split; got: %s", links)
	}
	if !strings.Contains(outgoing, "good-regulator-theorem") {
		t.Fatalf("corpus_links OUTGOING should resolve [[good-regulator-theorem]]; got: %s", links)
	}
	if !strings.Contains(outgoing, "ashby") {
		t.Fatalf("corpus_links OUTGOING should also resolve [[ashby]]; got: %s", links)
	}

	// Hop 4: read B → the fact only the crawl reaches.
	readB := invokeTool(t, agent, "corpus_read", `{"path":"cybernetics/theory/good-regulator-theorem"}`)
	if !strings.Contains(readB, "GRT_MARKER") {
		t.Fatalf("read(good-regulator-theorem) should hold GRT_MARKER; got: %s", readB)
	}

	// Reverse edge: corpus_links(B) → BACKLINKS includes A.
	back := invokeTool(t, agent, "corpus_links", `{"path":"cybernetics/theory/good-regulator-theorem"}`)
	_, backlinks, ok := strings.Cut(back, `"backlinks"`)
	if !ok {
		t.Fatalf("corpus_links wire missing backlinks; got: %s", back)
	}
	if !strings.Contains(backlinks, "cybernetics/theory/theory") {
		t.Fatalf("corpus_links BACKLINKS should include theory (reverse edge); got: %s", back)
	}
}
