// custom_pages_guide.go —— custom_page.guide: the frontend-authoring guide the owner's agent
// reads before writing a custom page. The MCP server instructions stay short (they compete for
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

//go:embed custompageguide/guide.md
var customPageGuide string

// customPageGuideOp —— the read-only guide tool. No deps: the guidance is static content, so it
// takes no CustomPageDeps.
func customPageGuideOp() fp.Op {
	return fp.Op{
		ID: "custom_page.guide",
		Description: "How to author a good custom page: the design system (tokens + fonts) every " +
			"build ships, the SDK widgets a page can import, how to show corpus content inline " +
			"instead of linking away, and how to avoid a generic AI look. Read this before " +
			"custom_page.write_file.",
		InputSchema: noArgs,
		Kind:        fp.Read,
		Reach:       fp.OwnerRead(),
		Invoke:      readCustomPageGuide(),
	}
}

// readCustomPageGuide —— returns the embedded guide as {"guide": "..."}. Static: it ignores the
// owner and the args.
func readCustomPageGuide() fp.Invoke {
	return func(_ context.Context, _ string, _ json.RawMessage) (json.RawMessage, error) {
		return json.Marshal(customPageGuideOut{Guide: customPageGuide})
	}
}

type customPageGuideOut struct {
	Guide string `json:"guide"`
}

// customPageGuideOps —— the guide is part of the custom-page authoring surface but carries no
// deps, so it's assembled separately and appended by customPageAuthoringOps.
func customPageGuideOps() []fp.Op {
	return []fp.Op{customPageGuideOp()}
}
