// candidate.go —— the ONE place a candidate visitor agent is assembled with its corpus tools
// LIVE. Build the retrieval plugin, start its host socket over the driver, wire it into the
// driver's plugin set, and BuildVisitorAgent — as one call, returning the agent + a cleanup.
//
// Why this exists (anti-rot): every entry point — the --ask BINARY and every eval test — must
// route retrieval through here. The old bug was structural, not a typo: the only shared helper
// (buildHostPlugin) was test-only (*testing.T), so the one non-test entry point (--ask) could
// not reuse it, hand-rolled its own EvalDriver WITHOUT the plugin+socket, and rotted silently
// to tools=0 (the model then hallucinated — "a startup called Finova" — with no corpus to
// read). A cohesive non-test launcher makes that impossible: there is no second assembly path
// to drift, and forgetting the socket is not expressible.

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// retrievalPluginDir —— the corpus.retrieval plugin module, relative to the eval-harness dir.
const retrievalPluginDir = "../mcp-servers/retrieval"

// buildRetrievalBinary —— compile the retrieval plugin to a host-arch binary (no GOOS override)
// so it runs as a plain stdio MCP server on this machine. Non-test core of buildHostPlugin, so
// the --ask binary can reuse the exact same build.
func buildRetrievalBinary(outDir string) (string, error) {
	bin := filepath.Join(outDir, "retrieval-plugin")
	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Dir = retrievalPluginDir
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("build retrieval plugin: %w\n%s", err, out)
	}
	return bin, nil
}

// retrievalPluginSpec —— the corpus.retrieval PluginSpec bound to a host socket. One
// definition, so the six fields can't drift between call sites.
func retrievalPluginSpec(bin, sock string) agentcore.PluginSpec {
	return agentcore.PluginSpec{
		ID: "corpus.retrieval", Command: bin,
		Env:     map[string]string{"RETRIEVAL_SOCKET": sock},
		HostOps: agentcore.CorpusHostOpNames(), RawToolNames: true, ACLAlways: true,
	}
}

// launchCandidate —— assemble a candidate visitor agent with corpus tools live. The caller
// pre-builds `driver` with corpus/roleBody/skill/mcp/cred; this appends the retrieval plugin,
// starts its host socket over the driver, and BuildVisitorAgent. Returns the agent + a cleanup
// (stop socket, remove temp) the caller must defer.
func launchCandidate(
	ctx context.Context, driver *EvalDriver, in *agentcore.LaunchInput,
) (*agentcore.VisitorAgent, func(), error) {
	tmp, err := os.MkdirTemp("/tmp", "smcand")
	if err != nil {
		return nil, nil, fmt.Errorf("candidate tmp: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(tmp) }

	bin, berr := buildRetrievalBinary(tmp)
	if berr != nil {
		cleanup()
		return nil, nil, berr
	}
	sock := filepath.Join(tmp, "r.sock")
	driver.plugins = append(driver.plugins, retrievalPluginSpec(bin, sock))

	stop, serr := agentcore.StartRetrievalSocket(ctx, driver, sock)
	if serr != nil {
		cleanup()
		return nil, nil, fmt.Errorf("start retrieval socket: %w", serr)
	}
	agent, aerr := agentcore.BuildVisitorAgent(ctx, driver, in)
	if aerr != nil {
		_ = stop()
		cleanup()
		return nil, nil, fmt.Errorf("build visitor agent: %w", aerr)
	}
	return agent, func() { _ = stop(); cleanup() }, nil
}
