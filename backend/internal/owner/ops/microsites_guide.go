// microsites_guide.go —— microsite.guide: the frontend-authoring guide the owner's agent
// reads before writing a microsite. The MCP server instructions stay short (they compete for
// context every session) and point here; the full guidance — the design system tokens, the SDK
// widgets a page can import, the "show corpus inline, don't just link out" rule, and the
// anti-generic-look checklist — lives in this on-demand tool so it costs context only when a page
// is actually being built. Embedded so the one guide serves both the MCP and HTTP faces.

package ops

import (
	"context"
	_ "embed"
	"encoding/json"

	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

//go:embed micrositeguide/guide.md
var micrositeGuide string

// micrositeGuideOp —— the read-only guide tool. No deps: the guidance is static content, so it
// takes no MicrositeDeps.
func micrositeGuideOp() fp.Op {
	return fp.Op{
		ID: "microsite.guide",
		Description: "How to author a good microsite: the design system (tokens + fonts) every " +
			"build ships, the SDK widgets a page can import, how to show corpus content inline " +
			"instead of linking away, and how to avoid a generic AI look. Read this before " +
			"microsite.write_file.",
		InputSchema: noArgs,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      readMicrositeGuide(),
	}
}

// readMicrositeGuide —— returns the embedded guide as {"guide": "..."}. Static: it ignores the
// owner and the args.
func readMicrositeGuide() fp.Invoke {
	return func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		return json.Marshal(micrositeGuideOut{Guide: micrositeGuide})
	}
}

type micrositeGuideOut struct {
	Guide string `json:"guide"`
}

// micrositeGuideOps —— the guide is part of the microsite authoring surface but carries no
// deps, so it's assembled separately and appended by micrositeAuthoringOps.
func micrositeGuideOps() []fp.Op {
	return []fp.Op{micrositeGuideOp()}
}
