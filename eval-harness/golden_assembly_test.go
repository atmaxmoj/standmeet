// golden_assembly_test.go —— #154 step 4: **the launcher** assembles the same capability set
// prod does for a vanilla (public, no grants) launch. Every acl:always plugin (ask-visitor,
// retrieval, summarize) is built and run for real over plain stdio; role-granted caps (booker,
// skill, ext-mcp) correctly stay OUT of a vanilla set.
//
// The subject is launchCandidateWith — the ONE path --ask and every eval test go through — not a
// hand-written plugin list. That distinction is the whole point of this file now: the old version
// declared the three PluginSpecs itself and asserted they assembled, which is a tautology. It
// stayed green for the six weeks in which --ask mounted only retrieval, so summarize_conversation
// and ask_visitor were structurally absent from every eval run and `make eval-summary` failed with
// "the agent never produced a summary report" — read as the model disobeying, when the tool it was
// asked to call did not exist. Assert what the launcher mounts, and that cannot recur silently.

package main

import (
	"context"
	"sort"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func TestEvalAssemblesProdCapabilitySet(t *testing.T) {
	ctx := context.Background()
	driver := &EvalDriver{
		cred:   evalCred(),
		corpus: []agentcore.VisitorCorpusEntry{{Genre: "wiki", Path: "p", Title: "T", Body: "B"}},
	}
	agent, cleanup, err := launchCandidate(ctx, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	if err != nil {
		t.Fatalf("launchCandidate: %v", err)
	}
	defer cleanup()

	got := agentToolNames(t, agent)
	sort.Strings(got)
	want := []string{"ask_visitor", "corpus_list", "corpus_read", "corpus_search", "summarize_conversation"}
	for _, w := range want {
		if !contains(got, w) {
			t.Fatalf("vanilla launch missing prod ACLAlways cap %q; assembled=%v", w, got)
		}
	}
	// role-granted caps must NOT leak into a vanilla (no-grant) launch — prod parity.
	for _, forbidden := range []string{"calendar_book", "calendar_list_slots"} {
		if contains(got, forbidden) {
			t.Fatalf("role-granted cap %q leaked into a vanilla launch; assembled=%v", forbidden, got)
		}
	}
}
