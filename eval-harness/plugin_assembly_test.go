// plugin_assembly_test.go —— #154 step 1: a standalone launch assembles a REAL
// externalized plugin, not just the in-process loaders. Proves the mini-host
// mechanism on the simplest plugin (ask-visitor: self-contained, no host socket):
// build its binary for the host, hand it to the EvalDriver as a PluginSpec, and assert
// the agent dials it over plain stdio (NO bwrap — bwrap is only prod's isolation) and
// assembles its ask_visitor tool. This is the registerDiscoveredPlugins half the eval
// used to skip; with it, eval discovers the same capabilities prod does.

package main

import (
	"context"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

func TestEvalAssemblesAskVisitorPlugin(t *testing.T) {
	bin := buildHostPlugin(t, "../mcp-servers/ask-visitor")
	driver := &EvalDriver{
		cred: evalCred(),
		plugins: []agentcore.PluginSpec{{
			ID:           "ask_visitor",
			Command:      bin,
			RawToolNames: true,
			ACLAlways:    true,
		}},
	}
	agent, err := agentcore.BuildVisitorAgent(context.Background(), driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	if err != nil {
		t.Fatalf("BuildVisitorAgent: %v", err)
	}
	names := agentToolNames(t, agent)
	if !contains(names, "ask_visitor") {
		t.Fatalf("ask_visitor not assembled by dialing the real plugin; got tools=%v", names)
	}
}

// buildHostPlugin —— compile a plugin module to a host-arch binary. Thin *testing.T wrapper
// over the non-test build (candidate.go) so tests that need only the binary (not a full launch)
// share the ONE build path with the --ask binary. moduleDir is honored for non-retrieval
// plugins; the retrieval module reuses buildRetrievalBinary.
func buildHostPlugin(t *testing.T, moduleDir string) string {
	t.Helper()
	if moduleDir == retrievalPluginDir {
		bin, err := buildRetrievalBinary(t.TempDir())
		if err != nil {
			t.Fatalf("%v", err)
		}
		return bin
	}
	bin := filepath.Join(t.TempDir(), "plugin")
	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Dir = moduleDir
	if out, berr := cmd.CombinedOutput(); berr != nil {
		t.Fatalf("build plugin %s: %v\n%s", moduleDir, berr, out)
	}
	return bin
}

// mustLaunch —— the *testing.T front for launchCandidate: assemble a candidate agent with
// corpus tools live, or fail. Every eval test that runs a turn goes through here, so retrieval
// is wired ONE way and a test cannot forget the socket (the --ask rot, made unrepeatable).
func mustLaunch(
	t *testing.T, driver *EvalDriver, in *agentcore.LaunchInput,
) *agentcore.VisitorAgent {
	t.Helper()
	agent, cleanup, err := launchCandidate(context.Background(), driver, in)
	if err != nil {
		t.Fatalf("launch candidate: %v", err)
	}
	t.Cleanup(cleanup)
	return agent
}

func agentToolNames(t *testing.T, a *agentcore.VisitorAgent) []string {
	t.Helper()
	out := make([]string, 0, len(a.Tools))
	for _, tl := range a.Tools {
		info, err := tl.Info(context.Background())
		if err != nil {
			t.Fatalf("tool info: %v", err)
		}
		out = append(out, info.Name)
	}
	return out
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}
