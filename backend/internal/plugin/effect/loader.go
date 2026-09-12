// loader.go —— the declarative layer over Scope: §5.2.1 of arXiv:2608.25512, ported from
// Koishi's `packages/loader` (MIT, © 2019-present Shigma).
//
// The core package gives *component developers* imperative primitives — apply an effect, take a
// slot. A separate concern is the *orchestrator*: the owner, who assembles pre-existing blocks into
// a running system and adjusts it over its lifetime. They do not call anything; they express a
// desired configuration, and the loader translates changes to that record into fiber operations.
//
// **Contract only. Every method panics.** Design: `docs/design/plugin/effects.md`.
//
// # Why a declarative layer rather than install/uninstall calls
//
// Theorem 80: the quiesced state is a function of the final configuration alone — whatever
// instantiations and retirements happen on the way, and in whatever order, the system ends where a
// load of the final configuration from scratch would have left it.
//
// That is the property that makes an owner-facing UI safe to build. With imperative calls the
// reachable states depend on click order, and every screen has to defend against sequences nobody
// enumerated. With a reconciled configuration there is one state per configuration, so the UI shows
// the configuration and nothing else.
//
// # Why entries rather than our four tables
//
// `installed_blocks`, `block_enabled`, `bundles`/`bundle_blocks` and the per-block config store
// already hold Definition 81's fields, spread across four independently-edited tables with no diff
// between them and what is running. The Entry below is those four brought into one record so that
// "what the owner asked for" is a value that can be compared against "what is running".

package effect

// State —— what an entry is doing. Deliberately distinguishes waiting from failed: an entry
// whose seam has no supplier is working exactly as designed (Thm 70), and showing it as an error is
// how a correct system gets reported as broken.
type State string

// The four states an owner can see an entry in. Only `StateFailed` is an error; the other three are
// the system working.
const (
	StateActive   State = "active"
	StateWaiting  State = "waiting" // a declared coeffect is unmet; not an error
	StateDisabled State = "disabled"
	StateFailed   State = "failed"
)

// Entry —— Definition 81: a single fiber's declaration.
//
// `Requires`/`Provides` are the seam relation that already exists in the manifest; they appear here
// because reconciliation needs them to decide activation order — or rather, to decide that there
// isn't one (Thm 70).
type Entry struct {
	ID        string            // stable identity; the reconciliation key
	URL       string            // which component to instantiate; changing it rebuilds
	Config    map[string]string // bound to the component to form its effect function
	Intercept map[string]string // interception annotation; read at use, never reloads
	Isolate   string            // realm: "" is local to this entry, else a shared realm name
	Requires  []string          // declared coeffects
	Provides  string            // the seam this entry supplies, if any

	Disabled       bool
	DisabledReason string // written back when a component disables itself

	Children []Entry // groups nest; annotations compose down
}

// Config —— the configuration tree: the authoritative record of what the system loads.
type Config struct {
	Entries []Entry
}

// Find returns the entry with this id anywhere in the tree, or nil.

// Loader —— reconciles a desired Config into running Scopes.
//
// The zero value is an empty, loaded-nothing Loader.

// Apply reconciles towards cfg, incrementally: per Definition 81 the loader dispatches on which of
// each entry's fields changed and applies the **least disruptive operation** for each — an
// `Intercept` change is read at use and needs no reload, a `Config` change is handed to the
// component to diff, `URL`/`ID` rebuild, `Disabled` unloads and reloads.
//
// Rebuilding one entry withdraws exactly what its fiber installed and leaves the fibers around it
// as they were (Corollary 69), so Apply never takes the system down to bring it back.

// Desired —— the record as it now stands, including anything components wrote back to it.

// SelfUpdate —— a component revising its own configuration. The change is written back to the
// entry, leaving that entry's other fields untouched: Definition 81's binding runs in both
// directions, and a screen that only reads the owner's side shows a stale answer whenever the
// system changed something itself.

// SelfDisable —— a component taking itself out of service, with a reason the owner can read.

// State —— what this entry is doing now.

// Active —— whether this entry is running.

// ConfigOf —— the config the entry is running with.

// Generation —— increments whenever the entry's scope is rebuilt. Exists so a test can tell
// "reloaded" from "updated in place", which is the whole content of the per-field dispatch rule and
// is otherwise invisible from the outside.

// Snapshot —— the quiesced state, comparable by value. Thm 80 is the claim that this depends on
// the final configuration and nothing else, so it is the thing two differently-reached loaders are
// compared on.
