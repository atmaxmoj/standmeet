// vocabulary.go -- the vocabulary an operation's declaration needs; the convergence point
// only **re-exports** it.
//
// The vocabulary itself lives in internal/infra/facadeparity: a domain must be able to
// state clearly what it does, and a domain must not import routing. If the vocabulary
// lived in the convergence point instead, the consequences cascade -- a domain couldn't
// speak it, so the declaration would have to move to the one place that can see both
// sides (the composition root), and then every resource would have to redeclare the input
// and output shape the domain already has, plus a chunk of plumbing to move it around.
//
// The face layer only imports the convergence point, so these aliases let a face stay
// ignorant of where the vocabulary actually lives.

package dispatcher

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// An operation's shape + what it does.
type (
	// Op -- one operation, the full declaration (id / description / input schema / kind /
	// reach / implementation).
	Op = fp.Op
	// Invoke -- what the operation actually does. Input and output are opaque JSON:
	// protocol-agnostic.
	Invoke = fp.Invoke
	// File -- one file's worth of bytes handed over alongside a call (a file picked in a
	// panel, for instance). Not stuffed into args: base64 in JSON costs a third more
	// memory, and it would grow into InputSchema, giving a generated face an extra
	// parameter it must never fill in.
	File = fp.File
)

// Accompanying bytes -- a face attaches bytes to this call (WithFiles), and the op side
// reads them (FilesFrom). This goes through ctx instead of adding a parameter to Invoke so
// the decorator chain stays singular: auth/quota/audit still wrap the same Invoke. Opening
// a second execution entry point would mean those policies would have to **remember** to
// wrap that one too.
var (
	WithFiles = fp.WithFiles
	FilesFrom = fp.FilesFrom
)

// Error classes -- a handful of protocol-agnostic classes, each face translates them into
// its own shape (HTTP status codes / MCP isError).
var (
	BadInput  = fp.BadInput
	NotFound  = fp.NotFound
	Conflict  = fp.Conflict
	Unauthed  = fp.Unauthed
	Forbidden = fp.Forbidden
	Upstream  = fp.Upstream

	IsBadInput  = fp.IsBadInput
	IsNotFound  = fp.IsNotFound
	IsConflict  = fp.IsConflict
	IsUnauthed  = fp.IsUnauthed
	IsForbidden = fp.IsForbidden
	IsUpstream  = fp.IsUpstream

	// Coded / CodeOf -- gives a face a machine-readable code (the frontend branches on
	// it), while the message stays the sentence meant for a person to read.
	Coded  = fp.Coded
	CodeOf = fp.CodeOf
)
