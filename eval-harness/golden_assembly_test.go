// golden_assembly_test.go —— #154 step 4: the eval assembles the SAME capability set prod
// does for a vanilla (public, no grants) launch. Every ACLAlways plugin (ask-visitor,
// retrieval, summarize) is run for real over plain stdio; role-granted caps (booker,
// skill, ext-mcp) correctly stay OUT of a vanilla set. This is the golden contract: if a
// capability silently dropped out of the eval, prod-parity would be broken and this fails.
//
// summarize assembles by merely running (its host socket is dialed only on tool-call, not
// at startup), so the golden set needs only the retrieval socket live.

package main

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func TestEvalAssemblesProdCapabilitySet(t *testing.T) {
	ctx := context.Background()
	askBin := buildHostPlugin(t, "../mcp-servers/ask-visitor")
	retrBin := buildHostPlugin(t, "../mcp-servers/retrieval")
	sumBin := buildHostPlugin(t, "../mcp-servers/summarize")

	sockDir, derr := os.MkdirTemp("/tmp", "smg")
	if derr != nil {
		t.Fatalf("sock dir: %v", derr)
	}
	defer func() { _ = os.RemoveAll(sockDir) }()
	retrSock := filepath.Join(sockDir, "r.sock")
	sumSock := filepath.Join(sockDir, "s.sock")

	driver := &EvalDriver{
		cred:   evalCred(),
		corpus: []agentcore.VisitorCorpusEntry{{Genre: "wiki", Path: "p", Title: "T", Body: "B"}},
		plugins: []agentcore.PluginSpec{
			{ID: "ask_visitor", Command: askBin, RawToolNames: true, ACLAlways: true},
			{
				ID: "corpus.retrieval", Command: retrBin,
				Env:          map[string]string{"RETRIEVAL_SOCKET": retrSock},
				HostOps:      agentcore.CorpusHostOpNames(),
				RawToolNames: true, ACLAlways: true,
			},
			{
				ID: "summarize_conversation", Command: sumBin,
				Env: map[string]string{"SUMMARIZE_SOCKET": sumSock},
				HostOps: []string{
					"conversation.read", "inference.generate", "report.store",
				},
				RawToolNames: true, ACLAlways: true,
			},
		},
	}

	stop, serr := agentcore.StartRetrievalSocket(ctx, driver, retrSock)
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
