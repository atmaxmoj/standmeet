// embed.go — embeds migrations/ into the backend binary.
//
// The only reason this file exists is **location**: `go:embed` cannot reach outside its own
// package directory, and migrations live in `backend/db/migrations/`. Putting a Go file next to
// them beats copying the .sql files into some package at build time — that copy step drifts, and
// the drift looks like "the migrations in the image are older than the code", with nothing to
// report it.
//
// The final image only COPYs the binary (backend/Dockerfile), so a read-from-disk approach has
// no file to read at all in prod. Once embedded, "this version is deployed" and "this version's
// schema changes are in hand" become the same fact.

// Package db — home of schema.sql and migrations/; this Go package only carries them via
// the go:embed directive.
package db

import "embed"

// Migrations — all the .sql files; filename is the order (ISO date prefix, lexical order =
// chronological order).
//
//go:embed migrations/*.sql
var Migrations embed.FS
