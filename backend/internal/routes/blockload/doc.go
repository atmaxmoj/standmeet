// Package blockload —— block loading/dispatch glue, living in the **routes reach-out
// layer**: it adapts blocks from every source (external MCP servers the owner
// registered, installed skills, OpenAPI agent tools, MCP-app sessions) into the unified
// fibers inside the registry container, for the visitor agent to dispatch.
//
// Why it's in routes rather than in the plugin substrate: producing a fiber **needs domain
// data** (role snapshot / MCP config / skill / VisitorSkillsDeps) — this is the side where
// "the block reaches into the domain to get material". If this lived in the substrate,
// the substrate would simultaneously be "depended on by the domain (as a container)" and
// "depend on the domain (to get material)" = a domain-level cycle. So, per the
// domain-facade-and-ddd-layout hierarchy:
//   - The container/mechanism (registry / sandbox / blocksocket / mcpclient / mount /
//     blockstore) = **the plugin leaf**, which never imports a domain; domains ask it
//     for blocks.
//   - The producer/glue (this package) = **the routes layer**, which is allowed to import
//     domains and register into the registry container. The plugin substrate stays a leaf,
//     and the domain-level dependency graph stays acyclic (enforced by check-domain-acyclic).
//
// The concrete blocks themselves are still externalized (mcp-servers/ sandboxes, or
// the owner side); this package is only the adapter that loads them into the container.
package blockload
