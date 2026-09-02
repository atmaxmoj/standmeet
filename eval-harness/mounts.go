// mounts.go —— mounts a **real plugin** onto the candidate: compiles it, generates a
// PluginSpec from its own manifest, and starts a host socket for whichever host ops its
// manifest names.
//
// Why this gets its own file: leaving out a capability's mount **raises no error** —— that
// capability's tools just don't show up in tools/list, the model has to answer in prose
// instead, and an assertion of "it called this tool" can then never go green. That's exactly
// how summarize went red: when P.13 moved eval onto agentcore.Driver, the --ask path only
// wired up retrieval, and neither ask_visitor nor summarize_conversation got wired at all ——
// three acl:always capabilities, all mounted in the product, only one mounted in eval.
//
// So what's here is a **table**, not three scattered call sites: which ones prod mounts is
// decided by the manifest's acl field, and this side mounts by that same id list. Adding
// another always-on capability means adding one row to the table, not remembering to wire it
// up somewhere else too.

package main

import (
	"context"
	"fmt"
	"os/exec"
	"path/filepath"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// The three acl:always capability ids + their plugin modules. prod mounts these three for
// every visitor.
const (
	askVisitorCapabilityID = "ask_visitor"
	retrievalCapabilityID  = "corpus.retrieval"
	summarizeCapabilityID  = "summarize_conversation"
)

// buildPluginBinary —— compiles a plugin module into a binary for the local architecture
// (prod runs it inside bwrap; the mini-host here runs it over plain stdio —— the isolation
// is prod's, the vocabulary is shared).
func buildPluginBinary(dir, out string) (string, error) {
	cmd := exec.Command("go", "build", "-o", out, ".")
	cmd.Dir = dir
	if outBytes, err := cmd.CombinedOutput(); err != nil {
		return "", fmt.Errorf("build plugin %s: %w\n%s", dir, err, outBytes)
	}
	return out, nil
}

// mountCapability —— compile + start socket + add to the driver's plugin set, in one go.
//
// Every field of spec (the host op list, the ACL tier, whether tool names stay as-is) is
// read from **its own manifest**; nothing here restates any of it: wherever it were restated,
// a manifest rename could stay green in eval while it's actually testing an interface that no
// longer exists in the product.
func mountCapability(
	ctx context.Context, driver *EvalDriver,
	capID, pluginDir, tmp string, host *agentcore.CapabilityHost,
) (func() error, error) {
	bin, berr := buildPluginBinary(pluginDir, filepath.Join(tmp, capID+"-plugin"))
	if berr != nil {
		return nil, berr
	}
	sock := filepath.Join(tmp, capID+".sock")
	spec, serr := agentcore.BuiltinPluginSpec(capID, bin, sock)
	if serr != nil {
		return nil, fmt.Errorf("%s plugin spec: %w", capID, serr)
	}
	stop := func() error { return nil }
	if len(spec.HostOps) > 0 {
		s, herr := agentcore.StartCapabilitySocket(ctx, host, capID, sock)
		if herr != nil {
			return nil, fmt.Errorf("start %s socket: %w", capID, herr)
		}
		stop = s
	}
	driver.plugins = append(driver.plugins, spec)
	return stop, nil
}

// mountBooker —— the real booker + a calendar that actually answers + its own record store.
//
// Only what's **outside the boundary** is canned (the calendar, the storage); the plugin,
// the host-op vocabulary, the ACL gate, and the assembly are all real —— a fake booking tool
// wouldn't prove anything about booker.
func mountBooker(
	ctx context.Context, driver *EvalDriver, tmp, ownerID string, opts *launchOpts,
) (func() error, error) {
	host, _ := bookingWorld(ownerID, ownerTZOr(opts.ownerTimezone), nil,
		opts.bookingFail, opts.bookingFailMsg)
	return mountCapability(ctx, driver, bookerCapabilityID, "../mcp-servers/booker", tmp, host)
}

// mountSummarize —— the real summarize plugin + the three host ops it needs: read this
// run's transcript, run one generation with the owner's model, and hand the HTML back to the
// host.
//
// Sanitizing against the allowlist and applying the template are the **host's** job (the
// security boundary), so the report really is the sanitized version; this side only supplies
// where the transcript comes from, which credential to use, and where to store the result
// once sanitized.
func mountSummarize(
	ctx context.Context, driver *EvalDriver, tmp string, opts *launchOpts,
) (func() error, error) {
	host := &agentcore.CapabilityHost{
		Timezone:   ownerTZOr(opts.ownerTimezone),
		Transcript: opts.transcript,
		Cred:       &driver.cred,
		Report:     opts.report,
	}
	return mountCapability(ctx, driver, summarizeCapabilityID, "../mcp-servers/summarize", tmp, host)
}

// mountAskVisitor —— the real ask_visitor plugin. It calls no host op at all (the question
// itself is its output), so it gets no socket.
func mountAskVisitor(
	ctx context.Context, driver *EvalDriver, tmp string,
) (func() error, error) {
	return mountCapability(ctx, driver, askVisitorCapabilityID, "../mcp-servers/ask-visitor", tmp, nil)
}
