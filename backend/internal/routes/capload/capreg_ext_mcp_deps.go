// capreg_ext_mcp_deps.go —— the connector-dep gate for ext-mcp tools (§1: ext-mcp does not
// wire deps by default).
//
// ext-mcp is lowest trust: someone else's process, where the owner only registered a URL.
// Even when its tool declares a dependency on some connector (like calendar) via
// `_meta.requires` and that connector is already connected, the handle is **not** injected
// by default — a connector handle carries owner privileges, and auto-granting it to any
// registered server would be handing out the owner's account. Both conditions must hold
// before it's allowed through:
//   ① the owner **explicitly granted** this dep in server.GrantedDeps (default empty = deny
//      everything);
//   ② the dep is already connected (checked against DepRegistry).
// Either unmet → hide the tool. A tool with no requires is unaffected by this gate. The
// logic is collected here, in the same module as ext-mcp tool exposure (capreg_ext_mcp.go's
// absorb calls into this file).

package capload

import (
	"context"
	"encoding/json"
	"slices"

	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpclient"
	marketplace "github.com/atmaxmoj/standmeet/internal/marketplace/facade"
)

// DepConnected —— whether a named connector dependency is connected (satisfied by
// capreg.DepRegistry). The grant lives in server config; connected status is checked here;
// a tool is allowed through only when both pass.
type DepConnected interface {
	AllConnected(ctx context.Context, ownerID string, deps []string) (bool, error)
}

// extToolDepsAllowed —— whether this ext-mcp tool's connector-dep is allowed through
// (lowest trust, deny by default): every dep in requires must be explicitly granted by the
// owner AND its connector already connected. A tool with no requires is unaffected by this
// gate.
func extToolDepsAllowed(
	ctx context.Context, cfg *marketplace.DialableMCPServer, connected DepConnected,
	t *mcpclient.Tool,
) bool {
	requires := toolRequires(t)
	if len(requires) == 0 {
		return true
	}
	if !allDepsGranted(cfg.GrantedDeps, requires) {
		return false // owner did not explicitly grant it → deny (default: deny everything)
	}
	if connected == nil {
		return false // no connected query wired in → deny conservatively (never expose a
		// tool that can call out externally when connectivity is unknown)
	}
	conn, err := connected.AllConnected(ctx, cfg.OwnerID, requires)
	return err == nil && conn
}

// allDepsGranted —— whether every dep in requires is in the owner's explicitly granted set.
func allDepsGranted(granted, requires []string) bool {
	for _, dep := range requires {
		if !slices.Contains(granted, dep) {
			return false
		}
	}
	return true
}

// toolRequires —— reads an ext-mcp tool's `_meta.requires` (JSON []string). Absent / wrong
// shape → empty. Extracted to []string via a JSON round-trip (avoiding an any/interface{}
// assertion on a map[string]any value: that would hit the forbidigo-bans-any vs.
// revive-wants-any tradeoff).
func toolRequires(t *mcpclient.Tool) []string {
	v, ok := t.Meta["requires"]
	if !ok {
		return []string{}
	}
	raw, merr := json.Marshal(v)
	if merr != nil {
		return []string{}
	}
	out := []string{}
	if json.Unmarshal(raw, &out) != nil {
		return []string{}
	}
	return out
}
