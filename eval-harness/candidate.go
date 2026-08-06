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
		Env:     map[string]string{agentcore.HostSocketEnv: sock},
		HostOps: agentcore.CorpusHostOpNames(), RawToolNames: true, ACLAlways: true,
	}
}

// bookerCapabilityID —— the shipped capability id. Everything else about the booker
// (host ops, ACL tier, tool naming) is read from ITS manifest, not restated here.
const bookerCapabilityID = "calendar.book"

// buildBookerBinary —— compile the booker plugin for this host (prod runs it inside bwrap;
// the mini-host runs it over plain stdio — isolation is prod's, vocabulary is shared).
func buildBookerBinary(outDir string) (string, error) {
	bin := filepath.Join(outDir, "booker-plugin")
	cmd := exec.Command("go", "build", "-o", bin, ".")
	cmd.Dir = "../mcp-servers/booker"
	if out, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("build booker plugin: %w\n%s", err, out)
	}
	return bin, nil
}

// mountBooker —— build the booker, start its host socket over a canned calendar/store, and add
// its manifest-derived PluginSpec to the driver. Returns the host (for assertions) + a stop func.
//
// The canned side is the OUTSIDE WORLD only (a calendar that answers, a store that keeps rows).
// The plugin, its host-op vocabulary and the assembly are the real ones — a canned booking tool
// would prove nothing about the booker.
func mountBooker(
	ctx context.Context, driver *EvalDriver, tmp, ownerID string, opts *launchOpts,
) (*agentcore.CapabilityHost, func() error, error) {
	bin, berr := buildBookerBinary(tmp)
	if berr != nil {
		return nil, nil, berr
	}
	sock := filepath.Join(tmp, "b.sock")
	spec, serr := agentcore.BuiltinPluginSpec(bookerCapabilityID, bin, sock)
	if serr != nil {
		return nil, nil, fmt.Errorf("booker plugin spec: %w", serr)
	}
	host, _ := bookingWorld(ownerID, ownerTZOr(opts.ownerTimezone), nil, opts.bookingFail)
	stop, herr := agentcore.StartCapabilitySocket(ctx, host, bookerCapabilityID, sock)
	if herr != nil {
		return nil, nil, fmt.Errorf("start booker socket: %w", herr)
	}
	driver.plugins = append(driver.plugins, spec)
	return host, stop, nil
}

// launchCandidate —— assemble a candidate visitor agent with corpus tools live. The caller
// pre-builds `driver` with corpus/roleBody/skill/mcp/cred; this appends the retrieval plugin,
// starts its host socket over the driver, and BuildVisitorAgent. Returns the agent + a cleanup
// (stop socket, remove temp) the caller must defer.
func launchCandidate(
	ctx context.Context, driver *EvalDriver, in *agentcore.LaunchInput,
) (*agentcore.VisitorAgent, func(), error) {
	return launchCandidateWith(ctx, driver, in, launchOpts{})
}

// ownerTZOr —— 没给就是 UTC(跟 prod 读不到 owner 时区时的兜底一致)。
func ownerTZOr(tz string) string {
	if tz == "" {
		return "UTC"
	}
	return tz
}

// launchOpts —— extra capabilities this launch mounts beyond corpus retrieval.
type launchOpts struct {
	// booking —— mount the REAL booker plugin over a canned calendar + store. Without it the
	// booker is structurally absent, which is what a role that granted nothing looks like.
	booking bool
	// bookingFail —— make one connector verb fail ("calendar.insert_event"), to drive the
	// can't-book paths. Empty = the calendar cooperates.
	bookingFail string
	// ownerTimezone —— what owner.meta reports. It MUST be the timezone the turn's instruction
	// also states: the booking policy (working hours) is evaluated in the owner's zone, so a
	// mini-host that says UTC while the prompt says New York makes an in-hours slot look closed
	// — and the eval blames the model for the harness's disagreement with itself.
	ownerTimezone string
}

func launchCandidateWith(
	ctx context.Context, driver *EvalDriver, in *agentcore.LaunchInput, opts launchOpts,
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
	stopAll := func() { _ = stop(); cleanup() }
	if opts.booking {
		_, stopBooker, merr := mountBooker(ctx, driver, tmp, in.OwnerID, &opts)
		if merr != nil {
			stopAll()
			return nil, nil, merr
		}
		inner := stopAll
		stopAll = func() { _ = stopBooker(); inner() }
	}
	agent, aerr := agentcore.BuildVisitorAgent(ctx, driver, in)
	if aerr != nil {
		stopAll()
		return nil, nil, fmt.Errorf("build visitor agent: %w", aerr)
	}
	return agent, stopAll, nil
}
