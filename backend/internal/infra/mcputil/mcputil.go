// Package mcputil —— the one shared helper for turning an owner-MCP tool's Go payload into a
// registry.MCPResult. Every owner-side block (core mcphandle + each externalized plugin)
// marshals its result the same way; this is that single impl, so no package copies it (the
// jobs plugin used to — its helpers.go comment predicted "extract a shared internal/mcputil
// package"). Lives in its own tiny package with a scoped forbidigo exemption: a generic JSON
// marshaller inherently takes `any` (json.Marshal does), the same schemaless-payload boundary
// already exempted for mcphandle / mcpclient / hostsocket — keeping the registry's own `any`
// ban strict.
package mcputil

import (
	"encoding/json"
	"fmt"
	"log/slog"

	"github.com/atmaxmoj/standmeet/internal/plugin/registry"
)

// MarshalResult —— JSON-marshal payload into a success result; a marshal error is logged
// (with the tool name) and returned as an MCPError.
func MarshalResult(log *slog.Logger, name string, payload any) registry.MCPResult {
	out, err := json.Marshal(payload)
	if err != nil {
		log.Error("block marshal", "tool", name, "err", err)
		return registry.MCPError(fmt.Sprintf("encode payload: %v", err))
	}
	return registry.MCPSuccess(string(out))
}

// NonNilStrings —— coalesce a nil slice to an empty one, so owner-MCP tool payloads marshal
// to a JSON `[]` rather than `null`. Shared by every owner-side block that echoes a string
// list back.
func NonNilStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
