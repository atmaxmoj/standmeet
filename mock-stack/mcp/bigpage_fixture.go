// bigpage_fixture.go —— a tool whose **result is too large to survive the context window**,
// plus a per-tool call count.
//
// The bill (F-D-14): in prod, a real third-party DeepWiki call to `read_wiki_contents`
// returned 374871 bytes, against a 32K-token window — that result **couldn't survive as a
// message at all**. Compaction swallowed it, the model noticed the evidence was gone and
// fetched it again, so fetch→compact→fetch-again happened, and the same call fired **8
// times** in one turn: the visitor waited 4 minutes, and the third party got pulled for 3MB.
//
// Judging this in e2e needs two things this fixture didn't have before:
//   - `big_page` — a tool whose result genuinely can't survive the window (ubiquitous in the
//     real world: a full wiki page, a spec, a full export).
//   - `GET /__mock/calls` — **dispatch counts**. The check is "did the same call actually hit
//     the other side again", and that has to be counted **from the side that got called**
//     ([[write-with-no-receipt]]: an assertion with no receipt proves nothing).
package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// bigPageMarker —— a sentence that appears nowhere else, buried in the body. The guard uses
// it to judge whether the model actually has this content in hand.
const bigPageMarker = "[BIG-PAGE-MARKER-8841]"

// bigPageTargetBytes —— body length. A 32K-token window is roughly 128K characters; this
// gives it 200K: **crosses the line in a single call**, not by accumulation. The prod
// incident was 374871 bytes, the same order of magnitude.
const bigPageTargetBytes = 200000

// counts —— how many times each tool was actually dispatched. This is exactly what the
// guard asks about.
var (
	countMu sync.Mutex
	counts  = map[string]int{}
)

func countCall(tool string) {
	countMu.Lock()
	defer countMu.Unlock()
	counts[tool]++
}

// counted —— wraps the counting in the **registration step** itself, rather than relying on
// each handler to remember to count.
//
// The bill: the first version only counted inside `big_page`, so the positive control
// (repeated calls to `ping_external` must still dispatch normally) read 0 — while the
// backend logs clearly showed those two calls happening. **The check was resting on a
// counter that had never counted that tool**, and it went red in a way indistinguishable
// from "the product deduped it". Once wrapped at registration, "a newly added tool forgot
// to count" becomes structurally impossible ([[structure-means-no-responsibility-class]]).
func counted(name string, h server.ToolHandlerFunc) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		countCall(name)
		return h(ctx, req)
	}
}

// serveCalls —— `{"big_page":2,"ping_external":1}`.
func serveCalls(w http.ResponseWriter, _ *http.Request) {
	countMu.Lock()
	snapshot := make(map[string]int, len(counts))
	for k, v := range counts {
		snapshot[k] = v
	}
	countMu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(snapshot); err != nil {
		_ = err
	}
}

// serveResetCalls —— each spec zeroes it for itself; the counter outlives a single run, and
// without resetting, an assertion would read counts left over from the previous round
// ([[assertion-that-cannot-fail]]'s bill came from exactly this: an unreset ring can never
// go red).
func serveResetCalls(w http.ResponseWriter, _ *http.Request) {
	countMu.Lock()
	counts = map[string]int{}
	countMu.Unlock()
	w.WriteHeader(http.StatusOK)
}

func bigPageTool() mcpgo.Tool {
	return mcpgo.NewTool(
		"big_page",
		mcpgo.WithDescription(
			"Fetch the full text of a large page. Returns far more than fits in one context window."),
		mcpgo.WithString("page", mcpgo.Required(), mcpgo.Description("page id to fetch")),
	)
}

//nolint:gocritic // the mcp-go interface requires a value-typed request; can't change it.
func bigPageHandler(
	_ context.Context, req mcpgo.CallToolRequest,
) (*mcpgo.CallToolResult, error) {
	page, _ := req.GetArguments()["page"].(string)
	return mcpgo.NewToolResultText(bigPageBody(page)), nil
}

// bigPageBody —— heading + marker + padding to the target length. The padding is
// **plausible prose**, not gibberish: a summarizing model needs something it can actually
// compress for this path to be shaped like the real thing.
func bigPageBody(page string) string {
	var b strings.Builder
	b.WriteString("PAGE: " + page + "\n\n")
	b.WriteString("Section 1 — Overview. " + bigPageMarker +
		" This page is the full text of the requested document.\n\n")
	const para = "The section below restates the operating detail at length: how the component is " +
		"deployed, which invariants it holds, what the failure modes look like from the outside, " +
		"and which knobs an operator is expected to touch. Nothing here is surprising on its own; " +
		"the point is that there is a great deal of it, and that it does not fit anywhere small.\n\n"
	for b.Len() < bigPageTargetBytes {
		b.WriteString(para)
	}
	return b.String()
}
