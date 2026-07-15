// nav_tools_test.go —— deterministic (no LLM) round-trip of the three navigation ops added on
// top of search/read/list/links: corpus_map / corpus_resolve / corpus_peek. Same wiring as
// crawl_retrieval_test (Driver corpus over the real retrieval plugin + host socket), so it
// exercises plugin schema → host runner → lister → wire, end to end.

package main

import (
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func navAgent(t *testing.T) *agentcore.VisitorAgent {
	t.Helper()
	driver := &EvalDriver{cred: evalCred(), corpus: linkedCorpus()}
	return mustLaunch(t, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
}

// TestNavToolsAssembled —— all seven corpus tools reach the agent.
func TestNavToolsAssembled(t *testing.T) {
	agent := navAgent(t)
	names := agentToolNames(t, agent)
	for _, want := range []string{
		"corpus_search", "corpus_read", "corpus_list", "corpus_links",
		"corpus_map", "corpus_resolve", "corpus_peek",
	} {
		if !contains(names, want) {
			t.Fatalf("%s not assembled; tools=%v", want, names)
		}
	}
}

// TestCorpusMapSkeleton —— the map returns the wiki node tree with per-branch counts. The
// linkedCorpus lives under cybernetics/theory/*, so the skeleton must show that branch.
func TestCorpusMapSkeleton(t *testing.T) {
	agent := navAgent(t)
	out := invokeTool(t, agent, "corpus_map", `{}`)
	if !strings.Contains(out, `"nodes"`) || !strings.Contains(out, "cybernetics") {
		t.Fatalf("map skeleton missing nodes/cybernetics: %s", out)
	}
	// theory node hides 3 descendants — its count must be carried whether expanded or collapsed.
	if !strings.Contains(out, `"count"`) {
		t.Fatalf("map nodes missing counts: %s", out)
	}
}

// TestCorpusResolveByName —— a bare name resolves to its exact path (no path guessing).
func TestCorpusResolveByName(t *testing.T) {
	agent := navAgent(t)
	out := invokeTool(t, agent, "corpus_resolve", `{"name":"good-regulator-theorem"}`)
	if !strings.Contains(out, "cybernetics/theory/good-regulator-theorem") {
		t.Fatalf("resolve didn't return the node path: %s", out)
	}
}

// TestCorpusPeekStub —— peek returns a node's signature (headings/outlinks/lead) without the
// full body, and batches multiple paths in one call.
func TestCorpusPeekStub(t *testing.T) {
	agent := navAgent(t)
	out := invokeTool(t, agent, "corpus_peek",
		`{"paths":["cybernetics/theory/theory","cybernetics/theory/good-regulator-theorem"]}`)
	if !strings.Contains(out, `"stubs"`) {
		t.Fatalf("peek missing stubs wire: %s", out)
	}
	// theory's body links to [[good-regulator-theorem]] — the stub's outlinks must surface it,
	// and the full GRT_MARKER body must NOT be in a stub (that's what corpus_read is for).
	if !strings.Contains(out, "good-regulator-theorem") {
		t.Fatalf("peek stub didn't surface the outlink: %s", out)
	}
	if strings.Contains(out, "GRT_MARKER") {
		t.Fatalf("peek leaked full body (GRT_MARKER) — should be a stub, not a read: %s", out)
	}
}
