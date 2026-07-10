// Package paritymanifest —— the CONCRETE owner-capability manifest (the single source of truth) +
// the adapters that check the real facades against it. The facade-agnostic mechanism lives in
// internal/facadeparity; this package fills it with the actual owner operations, mapping each
// to the real primitives that realize it (owner-MCP tool names, admin route "METHOD /path").
// server.New
// enumerates the live facades (registry.OwnerMCPBindings + chi.Walk of the admin router) and calls
// Check; a violation is a boot panic + a test failure (see paritymanifest_test.go).
//
// Reach vocabulary (facadeparity): OwnerAction / OwnerRead must appear on every owner action/read
// facade (today: mcp + admin); Only(reason, …) pins to named facades with a written reason;
// .Except(Browser|SecretBearing|Multipart) drops facades that can't carry that class. An
// OwnerAction/OwnerRead op with no MCP tool → "missing" until the MCP tool is added.
package paritymanifest

import fp "github.com/atmaxmoj/standmeet/internal/facadeparity"

// facade names — the two owner-facing facades wired today.
const (
	FacadeMCP   = "mcp"
	FacadeAdmin = "admin"
)

// manifestCap —— slice preallocation hint (comfortably above the current op count).
const manifestCap = 128

// Entry —— one manifest row: the canonical Op + the real primitives that realize it per facade. An
// op is "exposed" on a facade if ANY of its listed primitives is live there (handles the
// granularity mismatch, e.g. one admin route serves several genre-specific MCP tools).
type Entry struct {
	MCP   []string
	Admin []string
	Op    fp.Op
}

func act(id string, r fp.Reach) fp.Op  { return fp.Op{ID: id, Kind: fp.Action, Reach: r} }
func read(id string, r fp.Reach) fp.Op { return fp.Op{ID: id, Kind: fp.Read, Reach: r} }

// mcpFacade / adminFacade —— the two facade profiles. MCP carries plain JSON tools (no
// browser flow, no raw-secret trafficking, no multipart); admin (a browser app) carries all three.
func mcpFacade() fp.Facade {
	return fp.Facade{Name: FacadeMCP, ServesRead: true, ServesActn: true}
}

func adminFacade() fp.Facade {
	return fp.Facade{
		Name: FacadeAdmin, ServesRead: true, ServesActn: true,
		CanCarry: []fp.FacadeClass{fp.Browser, fp.SecretBearing, fp.Multipart},
	}
}

// Check —— run conformance of the two live facades against the manifest. mcpTools = the owner-MCP
// tool names the registry actually exposes; adminRoutes = "METHOD /full/path" the admin router
// actually mounts. Returns facadeparity violations (empty = conformant).
func Check(mcpTools, adminRoutes []string) []fp.Violation {
	m := Manifest()
	ops := make([]fp.Op, len(m))
	for i := range m {
		ops[i] = m[i].Op
	}
	return fp.Conform(ops, []fp.Exposure{
		exposureFor(mcpFacade(), mcpTools, func(e *Entry) []string { return e.MCP }),
		exposureFor(adminFacade(), adminRoutes, func(e *Entry) []string { return e.Admin }),
	})
}

// AdminRoutes —— every admin route the manifest claims. Used as the admin facade's live set for the
// self-consistency check (the real router is verified separately at boot via chi.Walk).
func AdminRoutes() []string {
	m := Manifest()
	seen := map[string]bool{}
	out := make([]string, 0, manifestCap)
	for i := range m {
		for _, a := range m[i].Admin {
			if !seen[a] {
				seen[a] = true
				out = append(out, a)
			}
		}
	}
	return out
}

// MCPMissing —— op-ids that per their Reach must be on the owner-MCP facade but aren't in liveMCP
// (the registry's live tool names). This is the paydown worklist: shrinking it = filling gaps.
func MCPMissing(liveMCP []string) []string {
	out := []string{}
	for _, v := range Check(liveMCP, AdminRoutes()) {
		if v.Facade == FacadeMCP && v.Kind == "missing" {
			out = append(out, v.OpID)
		}
	}
	return out
}

// exposureFor —— map a facade's live primitives to the manifest op-ids they realize. A live
// primitive
// claimed by no manifest entry surfaces as an orphan (its raw name isn't a manifest op-id).
func exposureFor(f fp.Facade, live []string, prims func(*Entry) []string) fp.Exposure {
	m := Manifest()
	byPrim := map[string]string{} // primitive → op-id
	for i := range m {
		for _, p := range prims(&m[i]) {
			byPrim[p] = m[i].Op.ID
		}
	}
	exposed := map[string]bool{}
	for _, p := range live {
		if id, ok := byPrim[p]; ok {
			exposed[id] = true
		} else {
			exposed[p] = true // unclaimed live primitive → orphan
		}
	}
	return fp.Exposure{Facade: f, Exposed: exposed}
}
