// Package capstore —— per-plugin isolated document storage, sitting on the **shared**
// Postgres (no separate database). Each connector / MCP capability gets its own schema:
// connector_<id> / mcp_<id>, created on install, DROPped on uninstall. Core data lives in
// `public`; plugin schemas always carry a **reserved prefix**, structurally separated from
// core.
//
// ⚠️ Dangerous boundary — DROP runs `DROP SCHEMA ... CASCADE`, deleting every row in that
// schema. If the schema-name derivation goes wrong and resolves to `public` or some core
// schema, DROP would **delete core data**. So every DROP must first pass schemaName +
// assertDroppable: no reserved prefix / empty id / a core schema name all get **refused**,
// never DROPped. See Drop's three hard rules. The schema name is always derived from the
// host-trusted (kind,id), never taken from a plugin request.
package capstore

import (
	"fmt"
	"regexp"
	"strings"
)

// Kind —— which plugin axis the storage belongs to. It determines the prefix, a structural
// marker for "this is not a core schema".
type Kind string

const (
	// KindConnector —— a connector's private storage, schema = connector_<id>.
	KindConnector Kind = "connector"
	// KindMCP —— an MCP capability's private storage, schema = mcp_<id>.
	KindMCP Kind = "mcp"
	// KindPage —— a custom page's own persistence namespace, schema = page_<id>. Same isolation
	// model as a plugin: its own schema (not a shared table keyed by id), dropped with the page.
	KindPage Kind = "page"
)

// kindPrefix —— axis → reserved prefix. A core schema never carries a prefix, so "has a
// prefix" ⟺ "is plugin storage, not core". The DROP guard uses this to keep core schemas out.
var kindPrefix = map[Kind]string{
	KindConnector: "connector_",
	KindMCP:       "mcp_",
	KindPage:      "page_",
}

// coreSchemas —— core schemas that must never be DROPped (belt-and-suspenders; the
// droppableRe prefix check already excludes them since they carry no reserved prefix — this
// adds an explicit blocklist layer on top).
var coreSchemas = map[string]bool{
	"public": true, "pg_catalog": true, "information_schema": true, "pg_toast": true,
}

// droppableRe —— a legal DROPpable schema name: reserved prefix + a pure [a-z0-9_] suffix.
// This both blocks core schemas and blocks identifier injection (a schema name in DDL can
// only be interpolated, never $1-parameterized, so the name must be locked down first).
var droppableRe = regexp.MustCompile(`^(connector|mcp|page)_[a-z0-9_]+$`)

// idSuffixRe —— sanitizes a plugin id (which may contain '-'/'.', e.g. google-calendar /
// calendar.book) into a legal suffix.
var idSuffixRe = regexp.MustCompile(`[^a-z0-9]+`)

// schemaName —— derive a schema name from the host-trusted (kind,id). The id is sanitized to
// [a-z0-9_]: illegal characters collapse to '_', leading/trailing '_' are trimmed. Empty id /
// empty after sanitizing / unknown kind → error (never return a name that might hit core).
func schemaName(kind Kind, id string) (string, error) {
	prefix, ok := kindPrefix[kind]
	if !ok {
		return "", fmt.Errorf("capstore: unknown kind %q", kind)
	}
	suffix := strings.Trim(idSuffixRe.ReplaceAllString(strings.ToLower(id), "_"), "_")
	if suffix == "" {
		return "", fmt.Errorf("capstore: empty schema id for kind %q", kind)
	}
	name := prefix + suffix
	if derr := assertDroppable(name); derr != nil {
		return "", derr // the derived name can't even pass the guard: a logic error, fail early
	}
	return name, nil
}

// assertDroppable —— the core-safety guard before DROP: the name must match reserved
// prefix + a clean suffix, and must not be in the core blocklist. Any non-conforming name →
// error, **never DROPped**. This is the "last gate before deleting a schema".
func assertDroppable(name string) error {
	if coreSchemas[name] {
		return fmt.Errorf("capstore: refuse to drop core schema %q", name)
	}
	if !droppableRe.MatchString(name) {
		return fmt.Errorf("capstore: refuse non-plugin schema %q (no reserved prefix)", name)
	}
	return nil
}
