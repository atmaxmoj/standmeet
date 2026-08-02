// retrieval_assembly_test.go —— #154 step 2: the eval mini-host assembles the REAL
// retrieval plugin against the Driver's corpus — no postgres, no bwrap. Build the
// retrieval binary, start a Driver-backed host-op socket (StartRetrievalSocket), point
// the plugin's host-socket env at it, and assert the launch (a) assembles corpus_search
// and (b) when invoked, searches the persona corpus over the socket — returning the
// GRANTED entry and NOT the private one (the granted-glob ACL applied in the bridge).
//
// This is the "正确装配" the eval was missing: retrieval is a discovered plugin, so it can
// only assemble by running the binary + backing its host op — exactly as prod does.

package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/cloudwego/eino/components/tool"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func TestEvalAssemblesRetrievalPlugin(t *testing.T) {
	ctx := context.Background()
	bin := buildHostPlugin(t, "../mcp-servers/retrieval")
	// short /tmp path — macOS caps unix socket paths at ~104 bytes, t.TempDir() is too deep.
	sockDir, derr := os.MkdirTemp("/tmp", "smr")
	if derr != nil {
		t.Fatalf("sock dir: %v", derr)
	}
	defer func() { _ = os.RemoveAll(sockDir) }()
	sock := filepath.Join(sockDir, "r.sock")

	driver := &EvalDriver{
		cred: evalCred(),
		corpus: []agentcore.VisitorCorpusEntry{
			{Genre: "wiki", Path: "lucerna", Title: "Lucerna", Body: "Marcus built Lucerna, a distributed cache."},
			{Genre: "wiki", Path: "vault", Title: "Vault", Body: "private lucerna vault notes", Private: true},
		},
		plugins: []agentcore.PluginSpec{{
			ID:      "corpus.retrieval",
			Command: bin,
			Env:     map[string]string{agentcore.HostSocketEnv: sock},
			// data plugin (orders host ops by name) → gets the session corpus_uris scope
			HostOps:      agentcore.CorpusHostOpNames(),
			RawToolNames: true,
			ACLAlways:    true,
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
	if !contains(agentToolNames(t, agent), "corpus_search") {
		t.Fatalf("corpus_search not assembled; tools=%v", agentToolNames(t, agent))
	}

	out := invokeTool(t, agent, "corpus_search", `{"query":"lucerna"}`)
	if !strings.Contains(out, "lucerna") {
		t.Fatalf("corpus_search didn't surface the granted entry over the socket; got: %s", out)
	}
	if strings.Contains(out, "vault") {
		t.Fatalf("corpus_search surfaced the PRIVATE entry — granted-glob ACL leak; got: %s", out)
	}
}

// invokeTool —— run an assembled tool by name with raw JSON args, returning its output.
func invokeTool(t *testing.T, a *agentcore.VisitorAgent, name, args string) string {
	t.Helper()
	for _, tl := range a.Tools {
		info, ierr := tl.Info(context.Background())
		if ierr != nil || info.Name != name {
			continue
		}
		inv, ok := tl.(tool.InvokableTool)
		if !ok {
			t.Fatalf("tool %s is not invokable", name)
		}
		out, rerr := inv.InvokableRun(context.Background(), args)
		if rerr != nil {
			t.Fatalf("invoke %s: %v", name, rerr)
		}
		return out
	}
	t.Fatalf("tool %s not found", name)
	return ""
}
