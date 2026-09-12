// loader_impl.go —— the implementation of §5.2's declarative layer. Contract: loader.go.
//
// # Checked against cordis's loader, which is what dsh's configuration tree is
//
// `packages/loader/src/config/entry.ts`, `Entry.update`, is the per-field dispatch Definition 81
// describes, and the order of its steps is the design:
//
//	if (this.disabled) { this.fiber?.dispose(); return }        // disabled wins, before any diff
//	const diff = Object.keys({...options, ...legacy})
//	  .filter(key => !deepEqual(this.options[key], legacy[key]))
//	if (!diff.length && !force) return                          // nothing changed → do NOTHING
//	await this._patchContext(diff)
//
// and `_patchContext` spends the diff:
//
//	Object.setPrototypeOf(this.ctx, this.parent.ctx)   // isolate/intercept: re-hang, no reload
//	if (diff.includes('config'))                       // config: hand it to the component
//	  await this.fiber.update(config)
//
// Three levels of disruption, chosen by which field moved, and the cheapest one is doing nothing at
// all. That is what `Generation` measures here: an entry whose generation did not move was not
// rebuilt, and a test can tell "updated in place" from "reloaded" — which is otherwise invisible
// from outside and is the whole content of the rule.

package effect

import (
	"maps"
	"slices"
	"sync"
)

// Loader —— reconciles a desired Config into running fibers.
type Loader struct {
	mu      sync.Mutex
	entries map[string]*loaded
	order   []string
}

type loaded struct {
	entry Entry
	gen   uint64
	state State
}

// flatten —— the config tree as a list, parents before children.
//
// Definition 81's groups nest, and annotations compose down; the tree shape is what the owner
// edits. Reconciliation works on the flattened list because an entry's identity is its `ID`, not
// its path: moving an entry between groups must not look like a delete plus an insert.
func flatten(entries []Entry, out *[]Entry) {
	for i := range entries {
		e := entries[i]
		children := e.Children
		e.Children = nil
		*out = append(*out, e)
		flatten(children, out)
	}
}

// Apply —— reconcile towards cfg, spending the least disruption each field allows.
func (l *Loader) Apply(cfg Config) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.init()

	var want []Entry
	flatten(cfg.Entries, &want)

	seen := make(map[string]bool, len(want))
	for i := range want {
		seen[want[i].ID] = true
		l.reconcile(&want[i])
	}
	l.withdrawUndeclared(seen)
	l.resolveLocked()
	return nil
}

// resolved —— which of the four States this entry is in, given what the tree provides.
//
// Waiting is not failing, and the order matters: disabled wins over waiting, because an entry the
// owner switched off should not also be reported as missing a dependency it never got to ask for.
func resolved(e *Entry, provided map[string]bool) State {
	switch {
	case e.Disabled:
		return StateDisabled
	case !satisfied(e.Requires, provided):
		return StateWaiting
	default:
		return StateActive
	}
}

func satisfied(requires []string, provided map[string]bool) bool {
	for _, k := range requires {
		if !provided[k] {
			return false
		}
	}
	return true
}

// rebuilds —— which fields force a new fiber, per Definition 81's least-disruptive dispatch.
//
// `URL` is the only one here: it names WHICH component to instantiate, so a change to it cannot be
// absorbed by the running one. `Config` is handed to the component to diff (cordis:
// `fiber.update`), `Intercept` and `Isolate` are read at use and re-hang the context without
// reloading, and `Disabled` is a state change rather than a rebuild — the entry keeps its
// identity so that re-enabling it is not indistinguishable from declaring a new one.
func rebuilds(prev, next *Entry) bool {
	return prev.URL != next.URL
}

// Desired —— the record as it now stands, including anything components wrote back to it.
func (l *Loader) Desired() Config {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := Config{}
	for _, id := range l.order {
		if e, ok := l.entries[id]; ok {
			out.Entries = append(out.Entries, e.entry)
		}
	}
	return out
}

// SelfUpdate —— a component revising its own configuration, written back to its entry.
//
// Definition 81's binding runs in BOTH directions, and this is the direction that is usually
// missed: a screen that only reads the owner's side shows a stale answer whenever the system
// changed something itself. The entry's SIBLING fields survive untouched, which is the other half
// — a component revising its config must not silently drop its own isolation or its own
// intercepts.
func (l *Loader) SelfUpdate(id string, cfg map[string]string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.init()
	e, ok := l.entries[id]
	if !ok {
		return ErrUnknownFiber
	}
	e.entry.Config = maps.Clone(cfg)
	return nil
}

// SelfDisable —— a component taking itself out of service, with a reason the owner can read.
//
// The reason is the point. "Disabled" with no reason is the screen that says a block is off while
// the owner is certain he never turned it off.
func (l *Loader) SelfDisable(id, reason string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.init()
	e, ok := l.entries[id]
	if !ok {
		return ErrUnknownFiber
	}
	e.entry.Disabled = true
	e.entry.DisabledReason = reason
	l.resolveLocked()
	return nil
}

// State —— what this entry is doing now.
func (l *Loader) State(id string) State {
	l.mu.Lock()
	defer l.mu.Unlock()
	if e, ok := l.entries[id]; ok {
		return e.state
	}
	return StateWaiting
}

// Active —— whether this entry is running.
func (l *Loader) Active(id string) bool { return l.State(id) == StateActive }

// ConfigOf —— the config the entry is running with.
func (l *Loader) ConfigOf(id string) map[string]string {
	l.mu.Lock()
	defer l.mu.Unlock()
	if e, ok := l.entries[id]; ok && e.entry.Config != nil {
		return maps.Clone(e.entry.Config)
	}
	// An entry that declares no config has an EMPTY config, not an absent one: the panel renders
	// what it is given, and nil would make "no fields" indistinguishable from "no such entry".
	return map[string]string{}
}

// Generation —— increments whenever the entry's fiber is rebuilt.
//
// Exists so a test can tell "reloaded" from "updated in place". Without it the per-field dispatch
// is unobservable from outside: both paths end with the entry running and the config current, and
// only the count says whether the component was torn down to get there.
func (l *Loader) Generation(id string) uint64 {
	l.mu.Lock()
	defer l.mu.Unlock()
	if e, ok := l.entries[id]; ok {
		return e.gen
	}
	return 0
}

// Snapshot —— the quiesced state, comparable by value.
//
// Theorem 80 is the claim that this depends on the final configuration and nothing else, so it is
// what two differently-reached loaders are compared on.
func (l *Loader) Snapshot() map[string]State {
	l.mu.Lock()
	defer l.mu.Unlock()
	out := make(map[string]State, len(l.entries))
	for id, e := range l.entries {
		out[id] = e.state
	}
	return out
}

// Find —— the entry with this id anywhere in the tree.
func (c Config) Find(id string) *Entry {
	var flat []Entry
	flatten(c.Entries, &flat)
	for i := range flat {
		if flat[i].ID == id {
			return &flat[i]
		}
	}
	return nil
}

func (l *Loader) init() {
	if l.entries == nil {
		l.entries = make(map[string]*loaded)
	}
}

// resolveLocked —— Theorem 70 at the entry level: an entry whose declared seam has no supplier
// WAITS, and waiting is not failing.
//
// The distinction is the whole reason `State` has four values: "an entry whose seam has no supplier
// is working exactly as designed, and showing it as an error is how a correct system gets reported
// as broken".
func (l *Loader) resolveLocked() {
	provided := map[string]bool{}
	for _, e := range l.entries {
		if !e.entry.Disabled && e.entry.Provides != "" {
			provided[e.entry.Provides] = true
		}
	}
	for _, e := range l.entries {
		e.state = resolved(&e.entry, provided)
	}
}

// reconcile —— bring one entry to what the owner declared, spending the least disruption its
// diff allows. Definition 81's per-field dispatch; see the file header for Cordis's version.
func (l *Loader) reconcile(e *Entry) {
	cur, exists := l.entries[e.ID]
	if !exists {
		l.entries[e.ID] = &loaded{entry: *e, gen: 1}
		l.order = append(l.order, e.ID)
		return
	}
	if rebuilds(&cur.entry, e) {
		cur.gen++ // compared BEFORE the assignment, or prev is already next
	}
	cur.entry = *e
}

// withdrawUndeclared —— an entry no longer declared is withdrawn: its effects revert, and
// nothing of it is left for a later Apply to find. Deletion is the same rule as disabling, taken to
// its end.
func (l *Loader) withdrawUndeclared(seen map[string]bool) {
	for id := range l.entries {
		if !seen[id] {
			delete(l.entries, id)
			l.order = slices.DeleteFunc(l.order, func(o string) bool { return o == id })
		}
	}
}
