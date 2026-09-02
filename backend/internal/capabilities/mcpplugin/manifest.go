// Package mcpplugin —— manifest + install-time discovery source for standard MCP
// plugins (Phase A / C1).
//
// The install config (JSON pointed to by STANDMEET_PLUGINS, shaped like Claude
// Desktop's mcpServers) declares a set of MCP plugins; core parses + version-gates
// + validates entry-by-entry at startup, producing a registrable []Manifest. This
// is the **pure data layer** — no dial, no registration, no touching transport.
// dial→list→wrap lives in C2/C3. See docs/design/platform-architecture.md for the
// design.
//
// Failure model: the whole JSON fails to parse → return error (fail-closed); a
// single manifest fails validation → skip it + add to Skipped (with reason,
// fail-open per-manifest), the rest proceed normally. The caller is responsible
// for logging Skipped (returned rather than logged internally → testable, no
// hidden side effect).
package mcpplugin

import mcpgoserver "github.com/mark3labs/mcp-go/server"

// SupportedVersion —— the manifest schema version this core accepts; a plugin
// with a different version → rejected.
const SupportedVersion = "1"

// Shape —— which side the plugin is exposed to (values match capreg.Shape; kept
// as its own type so this package stays a leaf).
type Shape string

// Shape enum values.
const (
	ShapeVisitorOnly Shape = "visitor_only"
	ShapeOwnerOnly   Shape = "owner_only"
	ShapeBoth        Shape = "both"
)

// Transport kind values.
const (
	// TransportStdio —— core spawns a child process, talks over stdin/stdout
	// (third-party plugins).
	TransportStdio = "stdio"
	// TransportHTTP —— connects to a URL (third-party plugins).
	TransportHTTP = "http"
	// TransportInProcess —— an in-process mcp-go server object (a built-in
	// capability shipped with the product, decoupled in code but running in the
	// same process). InProcessServer is filled in code at the composition root,
	// never through the JSON manifest (a Go object can't go into JSON).
	TransportInProcess = "in_process"
	// TransportSandboxStdio —— a third-party stdio server, but **the main process
	// starts it inside a restricted docker sandbox** (read-only root, --tmpfs,
	// only its own plugin dir mounted, no network by default), instead of a bare
	// spawn. Command/Args is the in-container start command; sandbox details live
	// in Transport.Sandbox. stdio flows transparently through the docker -i pipe;
	// dial follows the same path as plain stdio (the command is just wrapped in
	// docker).
	TransportSandboxStdio = "sandbox_stdio"
)

// Sandbox —— the sandbox declaration (from the JSON manifest) when
// kind=sandbox_stdio. PluginDir is this server's install directory on the host
// (where the owner's installed plugin lands); bubblewrap mounts it read-only into
// the sandbox's /plugin — that "specific directory" is the sandbox; the
// interpreter uses the host's read-only /usr, no image needed. AllowNet is only
// granted to plugins that genuinely need egress (the yt-dlp kind); no network by
// default.
type Sandbox struct {
	PluginDir string
	// HostOps —— the host-op names this plugin wants the host to open for it (the
	// fixed word list lives in routes/hostdesk).
	//
	// What's declared is **which things it wants**, not "mount me this socket
	// file" — the path is derived by the host from the plugin id. This grain size
	// is the crux: declare it as a file path and the mechanism can't answer "what
	// sits on this file", so it has to be hand-written one by one at the
	// composition root — which is how four gateways grew. Declare it as op names
	// instead, and the host just dispatches by name; asking for a name not in the
	// word list fails loudly at startup.
	//
	// Non-empty = this is a built-in that needs backend data → the host passes it
	// trusted session context via the tool-call `_meta`; third-party plugins
	// (that don't declare HostOps) get no session context and can't reach the
	// host either.
	HostOps  []string
	AllowNet bool
	// Workspace —— true = this server needs a **persistent per-visitor-session
	// workspace** (the file-writing kind, like server-filesystem). The host lazily
	// creates a directory keyed by conversation_id and bwrap --binds it into the
	// sandbox's /workspace (writable); no writing means no directory. This area has
	// a backend-controlled TTL + cron sweep (#148), so it never grows unbounded.
	// Default false (no persistent workspace, only ephemeral tmpfs /tmp).
	Workspace bool
}

// Transport —— a plugin's MCP transport declaration: stdio uses
// Command/Args/Env; http uses URL/Headers; in_process uses InProcessServer (a
// built-in capability shipped with the product, with the composition root filling
// in an in-process mcp-go server object in code). All three go through the same
// registration/dial path (unified), only branching by Kind at dial time.
type Transport struct {
	Env     map[string]string
	Headers map[string]string
	// InProcessServer —— the in-process *mcp-go server.MCPServer when
	// kind=in_process. json:"-": the Go object never enters the JSON config, it's
	// only filled by composition-root code.
	InProcessServer *mcpgoserver.MCPServer `json:"-"`
	// Sandbox —— the restricted-container declaration (from JSON) when
	// kind=sandbox_stdio.
	Sandbox *Sandbox
	Kind    string
	Command string
	URL     string
	Args    []string
}

// ACL values —— the exposure gate for a plugin's tools toward visitors.
const (
	// ACLRoleGranted —— default: exposed only if role.AllowedTools contains this
	// plugin's ID (same rule as echoer / an owner-registered third-party server).
	ACLRoleGranted = "role_granted"
	// ACLAlways —— exposed unconditionally to every mode (public/code/byoai),
	// ignoring role grants. Externalized built-in base capabilities (like
	// ask_visitor) use this, to keep the "every mode has it" semantics.
	ACLAlways = "always"
)

// OwnerTool —— one tool a plugin exposes to the **owner side**, pure **declared
// data** (name/description/input schema).
//
// Why data instead of something dialed out: the owner MCP's tool table has to be
// enumerable at assembly time (facade-parity reconciles against it too); relying
// on dial would mean spinning up the sandbox at startup. Declaration is data,
// implementation is in the sandbox — that's exactly the two plugin axes'
// {declaration(data) → implementation → instance} meta-structure; the host only
// dials **when actually called**.
//
// Name is the external name on owner MCP (like "calendar.list_slots"); Tool is
// the plugin's internal MCP tool name (like "calendar_list_slots"). Keeping them
// separate lets the owner-facing naming convention stay independent of the
// plugin's internal naming.
type OwnerTool struct {
	Name        string
	Tool        string
	Description string
	InputSchema string
}

// Manifest —— one MCP plugin declaration that passed validation.
type Manifest struct {
	Requires []string
	// VisitorTools —— the tool names this plugin offers on the **visitor side**.
	//
	// The truth lives on the sandbox side (whatever tools/list returns at dial
	// time is the truth); this is the declaration that answers **the question that
	// has to be answered before dialing**: "which tool belongs to which
	// capability". Without it, anywhere that needs this answer before assembly time
	// has no way to get it — a skill declares `allowed-tools: [calendar_book]`, and
	// the product can't tell "that needs the calendar connector".
	//
	// Because it's a **declaration** and the truth lives elsewhere, every time a
	// real dial happens, `Verify` checks it against the real answer: a mismatch
	// gets recorded as an error, and the real one is what binding uses. A
	// declaration is allowed to go stale, just not silently.
	VisitorTools []string
	// VisitorToolRequires —— tool name → the extra dependency **this one tool**
	// requires (an action-qualified name like `calendar:events.insert`). The
	// capability-level Requires answers "is it connected"; this layer answers
	// "can this connection do this one action".
	//
	// Without this layer, granting only a read-only calendar would still leave
	// "book a meeting" sitting in front of the visitor (403 every time, and the
	// visitor is told "try again later"); and bumping the whole Requires up to
	// write access would also hide "list slots" along with it — that's fixing
	// "an action offered that can't be done" by removing "an action that can be
	// done" (F-B-8).
	//
	// A tool absent from this table = no extra requirement, governed only by the
	// capability-level Requires.
	VisitorToolRequires map[string][]string
	// OwnerTools —— this plugin's owner-side tool declarations (meaningful only
	// when Shape includes owner).
	OwnerTools []OwnerTool
	// Config —— this plugin's configurable-field declarations. The owner panel
	// renders from it; values are stored in this plugin's own isolated storage.
	// Empty = this capability has nothing tunable.
	Config []ConfigField
	// CodeConfig —— the fields this plugin occupies on **one access code**. The
	// owner fills them in when issuing a code, and sees them together in the list.
	//
	// Same declaration shape as Config, just with the mount point switched from
	// owner to code. Before this existed, a capability wanting to put a number on
	// a code could only get it by hand-writing the whole thing at the composition
	// root (its own storage, its own read/write, its own wiring into the
	// issue-code input) — booker's max_bookings was exactly that: three files,
	// two hundred-plus lines, all a hand copy of this mechanism.
	CodeConfig []ConfigField
	// RoleConfig —— the fields this plugin occupies on **one role**. The owner
	// fills them in when creating a role.
	//
	// Same declaration shape as Config / CodeConfig, just with the mount point
	// switched to role. It differs from the other two in one way: a value on a
	// role gets **frozen** with the session (into RoleSnapshot's
	// capability_config), and the visitor's whole session runs on the config
	// as of when they came in. Before this existed, a per-role toggle could only
	// grow into a column on the kernel's roles table — notify_owner_on_booking was
	// exactly that: one column running through 9 generated files, a dedicated
	// query, an entity, a snapshot, the MCP schema, and every tool-call's `_meta`,
	// while the kernel should never have known what booking is.
	RoleConfig []ConfigField
	// Quota —— this plugin's per-code usage cap: how much is allowed, how much
	// has been used, both spelled out by the declaration. nil = this capability
	// doesn't gate usage.
	Quota *QuotaDecl
	// ClaimGate —— this capability's declaration that an action "said is done
	// must be done": if the answer asserts it completed, this turn must carry that
	// tool's success receipt. nil = this capability doesn't gate claims (whatever
	// it says needs no receipt behind it). See claimgate.go.
	ClaimGate *ClaimGateDecl
	ID        string
	Version   string
	// Title —— human-readable display name (the #109/#110 dock button label passes
	// it through). Same role as an MCP tool title: for display, distinct from the
	// programmatic ID. Empty = this capability has no title (not fit to be a dock
	// button label, no id fallback).
	Title            string
	Shape            Shape
	PromptFragmentID string
	// ACL —— the exposure gate: ACLRoleGranted (default) or ACLAlways.
	ACL       string
	Transport Transport
	// RawToolNames —— when true, tools use the server's original name (no
	// <id>_ prefix). Externalized built-in capabilities keep their canonical name
	// (ask_visitor stays ask_visitor, not ask_visitor_ask_visitor). Default false:
	// prefixed the same as ext-mcp, to avoid name collisions across multiple
	// third-party servers.
	RawToolNames bool
}
