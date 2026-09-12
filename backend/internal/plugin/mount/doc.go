// Package mount turns a block declaration into a fiber the registry can hold.
//
// A **block** is the atomic unit of code; a **fiber** is one loaded instance of it at runtime
// (`docs/design/plugin/block-model.md`). This package is the step between: it dials the transport
// the manifest declares (stdio / http / in_process / sandbox_stdio), wraps the tools the dial
// answers with as registry bindings, assembles the state the visitor's panel reads, and applies
// the gates that decide whether this session sees the block at all.
//
// It knows no domain. A loader that needs domain data — the ext-mcp loader, which reads the
// owner's registered MCP servers — lives in `internal/routes/blockload` instead, because a
// substrate the domains depend on cannot depend back on them.
package mount
