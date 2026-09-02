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
	"path/filepath"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// retrievalPluginDir —— the corpus.retrieval plugin module, relative to the eval-harness dir.
const retrievalPluginDir = "../mcp-servers/retrieval"

// buildRetrievalBinary —— compile the retrieval plugin to a host-arch binary (no GOOS override)
// so it runs as a plain stdio MCP server on this machine. Non-test core of buildHostPlugin, so
// the --ask binary can reuse the exact same build.
func buildRetrievalBinary(outDir string) (string, error) {
	return buildPluginBinary(retrievalPluginDir, filepath.Join(outDir, "retrieval-plugin"))
}

// retrievalPluginSpec —— the corpus.retrieval PluginSpec bound to a host socket. One
// definition, so the six fields can't drift between call sites.
func retrievalPluginSpec(bin, sock string) agentcore.PluginSpec {
	return agentcore.PluginSpec{
		ID: retrievalCapabilityID, Command: bin,
		Env:     map[string]string{agentcore.HostSocketEnv: sock},
		HostOps: agentcore.CorpusHostOpNames(), RawToolNames: true, ACLAlways: true,
	}
}

// bookerCapabilityID —— the shipped capability id. Everything else about the booker
// (host ops, ACL tier, tool naming) is read from ITS manifest, not restated here.
const bookerCapabilityID = "calendar.book"

// launchCandidate —— assemble a candidate visitor agent with corpus tools live. The caller
// pre-builds `driver` with corpus/roleBody/skill/mcp/cred; this appends the retrieval plugin,
// starts its host socket over the driver, and BuildVisitorAgent. Returns the agent + a cleanup
// (stop socket, remove temp) the caller must defer.
func launchCandidate(
	ctx context.Context, driver *EvalDriver, in *agentcore.LaunchInput,
) (*agentcore.VisitorAgent, func(), error) {
	return launchCandidateWith(ctx, driver, in, launchOpts{})
}

// ownerTZOr —— defaults to UTC when unset (matches prod's fallback when it can't read the owner's timezone).
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
	// bookingFail / bookingFailMsg —— make one connector verb fail ("calendar.insert_event")
	// with that message, to drive the can't-book paths. Empty verb = the calendar cooperates.
	// The message travels with the verb: the agent should take two different paths for "the slot's
	// taken" versus "the service errored".
	bookingFail    string
	bookingFailMsg string
	// ownerTimezone —— what owner.meta reports. It MUST be the timezone the turn's instruction
	// also states: the booking policy (working hours) is evaluated in the owner's zone, so a
	// mini-host that says UTC while the prompt says New York makes an in-hours slot look closed
	// — and the eval blames the model for the harness's disagreement with itself.
	ownerTimezone string
	// transcript / report —— the two things the summarize capability asks the host for: what was
	// said in this session, and where the scrubbed HTML lands. Leaving these nil makes their
	// respective bridges error out — instead of silently reading an empty transcript.
	transcript agentcore.TranscriptSource
	report     agentcore.ReportSink
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
	add := func(stopOne func() error) {
		inner := stopAll
		stopAll = func() { _ = stopOne(); inner() }
	}
	// The two remaining acl:always capabilities. prod mounts them for every visitor — if this side
	// didn't, an assertion like "it called summarize_conversation / ask_visitor" could never go
	// green, and the failure would read as the model misbehaving.
	for _, mount := range []func() (func() error, error){
		func() (func() error, error) { return mountAskVisitor(ctx, driver, tmp) },
		func() (func() error, error) { return mountSummarize(ctx, driver, tmp, &opts) },
	} {
		stopOne, merr := mount()
		if merr != nil {
			stopAll()
			return nil, nil, merr
		}
		add(stopOne)
	}
	if opts.booking {
		stopBooker, merr := mountBooker(ctx, driver, tmp, in.OwnerID, &opts)
		if merr != nil {
			stopAll()
			return nil, nil, merr
		}
		add(stopBooker)
	}
	agent, aerr := agentcore.BuildVisitorAgent(ctx, driver, in)
	if aerr != nil {
		stopAll()
		return nil, nil, fmt.Errorf("build visitor agent: %w", aerr)
	}
	return agent, stopAll, nil
}
