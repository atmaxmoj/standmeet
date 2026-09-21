// mounts.go —— mounts a **real plugin** onto the candidate: compiles it, generates a
// PluginSpec from its own manifest, and starts a host socket for whichever host ops its
// manifest names.
//
// Why this gets its own file: leaving out a block's mount **raises no error** —— that
// block's tools just don't show up in tools/list, the model has to answer in prose
// instead, and an assertion of "it called this tool" can then never go green. That's exactly
// how summarize went red: when P.13 moved eval onto agentcore.Driver, the --ask path only
// wired up retrieval, and neither ask_visitor nor summarize_conversation got wired at all ——
// three acl:always blocks, all mounted in the product, only one mounted in eval.
//
// So what's here is a **table**, not three scattered call sites: which ones prod mounts is
// decided by the manifest's acl field, and this side mounts by that same id list. Adding
// another always-on block means adding one row to the table, not remembering to wire it
// up somewhere else too.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// The three acl:always block ids + their plugin modules. prod mounts these three for
// every visitor.
const (
	askVisitorBlockID = "ask_visitor"
	retrievalBlockID  = "corpus.retrieval"
	summarizeBlockID  = "summarize_conversation"
)

// pluginEntry —— the JS file `node` runs as a plugin's MCP server, read from its
// package.json "main". eiab migrated every builtin plugin from a Go module to a JS dsh plugin
// (prod runs `node <main>` per the block manifest); node resolves the same "main", and it
// matches the manifest's args, so this stays single-sourced. Absolute path so node finds the
// plugin's own node_modules regardless of cwd. Errors loudly if the plugin or its deps are
// missing (run infra/plugins/provision.sh) rather than launching a node that exits → tools=0.
func pluginEntry(dir string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", fmt.Errorf("plugin dir %s: %w", dir, err)
	}
	raw, rerr := os.ReadFile(filepath.Join(abs, "package.json"))
	if rerr != nil {
		return "", fmt.Errorf("read %s/package.json (run infra/plugins/provision.sh?): %w", abs, rerr)
	}
	var pkg struct {
		Main string `json:"main"`
	}
	if jerr := json.Unmarshal(raw, &pkg); jerr != nil {
		return "", fmt.Errorf("parse %s/package.json: %w", abs, jerr)
	}
	if pkg.Main == "" {
		return "", fmt.Errorf("%s/package.json has no \"main\"", abs)
	}
	return filepath.Join(abs, pkg.Main), nil
}

// mountBlock —— compile + start socket + add to the driver's plugin set, in one go.
//
// Every field of spec (the host op list, the ACL tier, whether tool names stay as-is) is
// read from **its own manifest**; nothing here restates any of it: wherever it were restated,
// a manifest rename could stay green in eval while it's actually testing an interface that no
// longer exists in the product.
func mountBlock(
	ctx context.Context, driver *EvalDriver,
	capID, pluginDir, tmp string, host *agentcore.BlockHost,
) (func() error, error) {
	js, jerr := pluginEntry(pluginDir)
	if jerr != nil {
		return nil, jerr
	}
	sock := filepath.Join(tmp, capID+".sock")
	spec, serr := agentcore.BuiltinPluginSpec(capID, "node", sock)
	if serr != nil {
		return nil, fmt.Errorf("%s plugin spec: %w", capID, serr)
	}
	spec.Args = []string{js}
	stop := func() error { return nil }
	if len(spec.HostOps) > 0 {
		s, herr := agentcore.StartBlockSocket(ctx, host, capID, sock)
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
	return mountBlock(ctx, driver, bookerBlockID, "../infra/plugins/booker", tmp, host)
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
	host := &agentcore.BlockHost{
		Timezone:   ownerTZOr(opts.ownerTimezone),
		Transcript: opts.transcript,
		Cred:       &driver.cred,
		Report:     opts.report,
	}
	return mountBlock(ctx, driver, summarizeBlockID, "../infra/plugins/summarize", tmp, host)
}

// mountAskVisitor —— the real ask_visitor plugin. It calls no host op at all (the question
// itself is its output), so it gets no socket.
func mountAskVisitor(
	ctx context.Context, driver *EvalDriver, tmp string,
) (func() error, error) {
	return mountBlock(ctx, driver, askVisitorBlockID, "../infra/plugins/ask-visitor", tmp, nil)
}
