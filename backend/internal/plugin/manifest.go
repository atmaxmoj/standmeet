// manifest.go — what a block declares about itself.
//
// One shape, replacing two. The two plugin axes this design replaced each had their
// own descriptor and their own loader, differing mostly in which struct the YAML was
// translated into. The union is this file; the three merges it performs are the whole
// of that merge:
//
//	category    → Provides      the seam a block SUPPLIES
//	owner_ops   → OwnerTools    the same shape under two names
//	kind/spec/binding/protocol/auth_scheme → Transport
//
// Provides is the field neither axis could have carried alone. The consuming side said
// `requires: [calendar]` and the supplying side said `category: calendar`, so the two
// halves of one sentence lived in two vocabularies — and one of them, "smtp", was
// not in a manifest at all but hand-written in the composition root. A seam is a
// name; both halves now spell it the same way, in data.

package plugin

// SupportedVersion —— the manifest schema version this host accepts. A block
// declaring anything else is refused at load rather than half-understood.
const SupportedVersion = "1"

// Shape —— who a block serves.
type Shape string

// The three shapes. `both` is not a defect to be split: one implementation serving the
// visitor's agent and the owner is how calendar.book avoids the drift that happened when
// policy evaluation and slot enumeration were written twice.
const (
	ShapeVisitorOnly Shape = "visitor_only"
	ShapeOwnerOnly   Shape = "owner_only"
	ShapeBoth        Shape = "both"
)

const (
	// TransportStdio —— the host spawns a child process and talks over stdin/stdout.
	TransportStdio = "stdio"
	// TransportHTTP —— the host connects to a URL.
	TransportHTTP = "http"
	// TransportInProcess —— an in-process MCP server object.
	TransportInProcess = "in_process"
	// TransportSandboxStdio —— a stdio server the host spawns under bwrap.
	TransportSandboxStdio = "sandbox_stdio"
	// TransportOpenAPI —— an OpenAPI spec plus a binding, executed by the host.
	TransportOpenAPI = "openapi"
	// TransportProtocol —— a wire protocol the host speaks directly (SMTP, CalDAV).
	TransportProtocol = "protocol"
)

const (
	// ACLRoleGranted —— default: reachable only if the visitor's grant names it.
	ACLRoleGranted = "role_granted"
	// ACLAlways —— reachable in every mode, granted or not.
	ACLAlways = "always"
)

// The config field types the panel can render. A declaration outside this set is refused at
// load: the panel renders BY TYPE and knows nothing about any particular block, so a type it
// cannot render is a field the owner would never be able to fill in.
const (
	ConfigTypeString     = "string"
	ConfigTypeInt        = "int"
	ConfigTypeBool       = "bool"
	ConfigTypeTime       = "time"
	ConfigTypeStringList = "string_list"
)

// Manifest — one block's complete declaration, as read off disk.
//
// Only ID is mandatory. A block that declares nothing else is legal and inert:
// `telegram` is four lines. Absence must stay cheap, because the cost of adding a
// block is the thing this design is measured on.
type Manifest struct {
	ID      string `yaml:"id"`
	Title   string `yaml:"title"`
	Version string `yaml:"version"`

	// Provides — the seam this block supplies, if any. Empty means it supplies
	// nothing and is merely a consumer.
	//
	// One seam may have several suppliers (a Google calendar and a CalDAV one);
	// which is live is the owner's choice, expressed by what he put in the bundle,
	// not by a rule here.
	//
	// This is §6.2's **exclusive binding**, not a hole in the single-source rule:
	// "several implementations share one interface but at most one is bound at a
	// time; the orchestrator selects which implementation is bound". The owner is
	// that orchestrator, and `plugin.NewResolver` refusing two LIVE suppliers of one
	// seam is O-Insert's fourth premise (p ∩ p_m = ∅) enforced. The other route the
	// paper offers is a broker, which we have not built.
	Provides string `yaml:"provides"`

	// Requires — the seams this block needs before it can work. Names from the
	// same namespace as Provides.
	//
	// This is block-level: "is there a calendar at all". A single tool needing
	// something extra declares it on itself — see VisitorTool.Requires, which is
	// not a refinement but a different question (F-B-8).
	Requires []string `yaml:"requires"`

	// Shape — who this block serves: visitor_only, owner_only, or both.
	//
	// Both is not a defect to be split apart. calendar.book serves the visitor's
	// agent and the owner from ONE implementation; the two were once written twice
	// and drifted (policy evaluation and slot enumeration, in particular).
	Shape Shape `yaml:"shape"`

	// PromptFragmentID — the id of the system-prompt fragment this block
	// contributes, when it contributes one.
	//
	// It has to be nameable from outside because a session's prompt composition is
	// recorded as a list of fragment ids: when a grant removes this block, the id
	// must drop out of that list too, or the composition hash says the prompt is
	// unchanged while its text changed.
	PromptFragmentID string `yaml:"prompt_fragment_id"`

	// ACL — how a visitor comes to have this: "role_granted" or "always".
	// Empty reads as role_granted. A missing declaration must never widen access.
	ACL string `yaml:"acl"`

	Transport    Transport     `yaml:"transport"`
	VisitorTools []VisitorTool `yaml:"visitor_tools"`
	OwnerTools   []OwnerTool   `yaml:"owner_tools"`
	Config       []ConfigField `yaml:"config"`
	CodeConfig   []ConfigField `yaml:"code_config"`
	RoleConfig   []ConfigField `yaml:"role_config"`
	Quota        Quota         `yaml:"quota"`
	ClaimGate    ClaimGate     `yaml:"claim_gate"`

	// RawToolNames — the block's tools are exposed under the names it reports,
	// unprefixed. Last because field order follows pointer width (govet
	// fieldalignment), and a bool is the narrowest thing here.
	RawToolNames bool `yaml:"raw_tool_names"`
}

// Transport — how the host reaches this block's code.
//
// The host does not link a block. It starts one and speaks MCP to it, which is why
// a block can be written in any language and by anyone. Kind selects which of the
// fields below apply; the rest stay zero.
//
// Field order follows pointer width — enforced by govet fieldalignment — so the grouping
// below is by size, not by subject. The comments carry the subject instead.
type Transport struct {
	//nolint:forbidigo // the substrate must NOT name the MCP server type: knowing it would
	// couple every block declaration to the vendor library, which is the coupling the
	// manifest exists to remove. The one place that needs the concrete type asserts it
	// (mount/dial.go), and a wrong type there is a dial error naming the block, not a panic.
	InProcessServer any               `yaml:"-"`
	Env             map[string]string `yaml:"env"`
	Headers         map[string]string `yaml:"headers"`
	Sandbox         *Sandbox          `yaml:"sandbox"`
	URL             string            `yaml:"url"`
	Kind            string            `yaml:"kind"`
	Command         string            `yaml:"command"`
	Spec            string            `yaml:"spec"`
	Binding         string            `yaml:"binding"`
	Protocol        string            `yaml:"protocol"`
	AuthScheme      string            `yaml:"auth_scheme"`
	SpecBytes       []byte            `yaml:"-"`
	BindingBytes    []byte            `yaml:"-"`
	Args            []string          `yaml:"args"`
}

// Sandbox — the confinement a spawned block runs under.
//
// HostOps names WHAT the block wants from the host, never a path. The socket path
// is derived from the trusted id at load time; a declaration that could name a
// file could name someone else's.
type Sandbox struct {
	PluginDir string   `yaml:"plugin_dir"`
	HostOps   []string `yaml:"host_ops"`
	AllowNet  bool     `yaml:"allow_net"`
	Workspace bool     `yaml:"workspace"`
}

// VisitorTool / OwnerTool / ConfigField / Quota / ClaimGate — what a manifest declares about
// its tools and settings — live in manifest_decls.go.
