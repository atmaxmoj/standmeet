// Package capload —— capability loading/dispatch glue, living in the **routes reach-out
// layer**: it adapts capabilities from every source (external MCP servers the owner
// registered, installed skills, OpenAPI agent tools, MCP-app sessions) into the unified
// capabilities inside the capreg container, for the visitor agent to dispatch.
//
// Why it's in routes rather than capabilities: producing a capability **needs domain data**
// (role snapshot / MCP config / skill / VisitorSkillsDeps) — this is the side where "the
// capability reaches into the domain to get material". If this lived in capabilities,
// capabilities would simultaneously be "depended on by the domain (as a container)" and
// "depend on the domain (to get material)" = a domain-level cycle. So, per the
// domain-facade-and-ddd-layout hierarchy:
//   - The container/mechanism (capreg / sandbox / capsocket / mcpclient / mcpplugin /
//     capstore) = **the capabilities leaf**, which never imports a domain; domains ask it
//     for capabilities.
//   - The producer/glue (this package) = **the routes layer**, which is allowed to import
//     domains and register into the capreg container. capabilities stays a leaf, and the
//     domain-level dependency graph stays acyclic (enforced by check-domain-acyclic).
//
// The concrete capabilities themselves are still externalized (mcp-servers/ sandboxes, or
// the owner side); this package is only the adapter that loads them into the container.
package capload
