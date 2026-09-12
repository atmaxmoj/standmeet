// scope.go —— the implementation of §3.1's effect context. Contract and rationale: effect.go.
//
// The one structural decision worth stating here: **a child scope is an entry in its parent's
// accumulator**, not a separate list beside it.
//
// Definition 52 makes an instantiation one kind of iteration, whose inverse (retiring the child)
// joins the accumulator like any other. Keeping children in a second list would give two orders to
// reconcile at unload, and the LIFO of Definition 9 would hold within each list and not across them
// — so a parent that registered effect, child, effect would revert them in an order the paper
// does not license. One list, one order.

package effect

import (
	"errors"
	"maps"
	"slices"
	"strings"
	"sync"
)

// undoable —— one element of the accumulator φ: an inverse, whatever it owns, and whether it
// has already run.
//
// `done` is what makes a handle idempotent. Cordis spells the same guard with the runner's epoch
// (`if (!runner.epoch) return; runner.epoch = false`); §3.1.1's recover resets φ to the identity,
// and an inverse already applied is part of that identity — running it twice is not a no-op for
// `DROP SCHEMA` or `free`.
//
// `owned` is the nesting. In `fiber.ts` the collector does
//
//	collect: (dispose) => { disposables.push(dispose); this._disposables.delete(dispose) }
//
// — an effect registered from INSIDE another effect's setup is taken off the fiber's list and put
// on the outer effect's own, so disposing the outer one disposes what it created. Without that move
// the inner effect survives its parent's handle, and `ctx.effect()` stops being compositional.
type undoable struct {
	label string
	undo  Dispose
	owned []*undoable
	done  bool
}

// state —— the mutable half of a Scope, kept behind a pointer so the zero Scope costs nothing
// and still works: `var s Scope` is the initial effect context (γ₀, id).
type state struct {
	mu        sync.Mutex
	parent    *Scope
	acc       []*undoable
	unloaded  bool
	table     *Table
	providers map[string]string
}

func (s *Scope) st() *state {
	s.once.Do(func() { s.inner = &state{} })
	return s.inner
}

// Coeffects —— this scope's Σ projection (Definition 28). Derived from the parent's, so a
// child reads what its parent provided unless it isolates the key itself (Definition 24).
func (s *Scope) Coeffects() *Table {
	st := s.st()
	st.mu.Lock()
	defer st.mu.Unlock()
	if st.table == nil {
		var parent *Table
		if st.parent != nil {
			parent = st.parent.Coeffects()
		}
		st.table = &Table{parent: parent, owner: s}
	}
	return st.table
}

// Child —— derive a nested scope, and push its unload onto this scope's accumulator.
func (s *Scope) Child(label string) *Scope {
	st := s.st()
	child := &Scope{}
	child.st().parent = s

	st.mu.Lock()
	defer st.mu.Unlock()
	if st.unloaded {
		// The parent has already recovered; a child of it is born inactive rather than becoming an
		// accumulator nothing will ever run.
		child.st().unloaded = true
		return child
	}
	st.acc = append(st.acc, &undoable{label: "child:" + label, undo: child.Unload})
	return child
}

// Effect —— apply setup, push its inverse onto φ, and hand back the handle that reverts this
// one.
func (s *Scope) Effect(label string, up Setup) (Dispose, error) {
	if !s.Active() {
		return nil, ErrInactive
	}
	st := s.st()

	st.mu.Lock()
	mark := len(st.acc)
	st.mu.Unlock()

	dispose, err := applied(up)
	if err != nil {
		return nil, errors.Join(err, s.rollbackTo(mark))
	}

	st.mu.Lock()
	if st.unloaded {
		// Unloaded while the setup ran: no accumulator will ever reach this, so revert it now.
		st.mu.Unlock()
		return nil, errors.Join(ErrInactive, dispose())
	}
	// Whatever the setup registered on this scope while it ran belongs to THIS effect: take it off
	// the accumulator and hang it here, so the handle returned below disposes what it created.
	e := &undoable{label: label, undo: dispose}
	if mark <= len(st.acc) {
		e.owned = append(e.owned, st.acc[mark:]...)
		st.acc = st.acc[:mark]
	}
	st.acc = append(st.acc, e)
	st.mu.Unlock()

	return func() error { return run(st, e) }, nil
}

// applied —— run a setup and hold it to Definition 8: an effect function yields an inverse, and
// one that yields none is not an effect function. Refusing is the only option that keeps Theorem 7
// true, because an untrackable transformation inside a revertible Scope makes its promise false.
func applied(up Setup) (Dispose, error) {
	dispose, err := up()
	if err != nil {
		return nil, err
	}
	if dispose == nil {
		return nil, ErrNoInverse
	}
	return dispose, nil
}

// rollbackTo —— revert whatever the setup registered WITHIN its own call, so a failed setup
// leaves no residue (Cordis: `catch { dispose(); throw }`).
//
// Only what passed through this Scope: a setup that writes the world directly is outside the
// boundary this package tracks (§6.1), and no accumulator can reach it.
func (s *Scope) rollbackTo(mark int) error {
	st := s.st()
	st.mu.Lock()
	if mark > len(st.acc) {
		st.mu.Unlock()
		return nil
	}
	partial := st.acc[mark:]
	st.acc = st.acc[:mark]
	st.mu.Unlock()
	return revert(partial)
}

// run —— apply one inverse exactly once, then whatever it owns.
//
// Own inverse FIRST, then the nested ones newest-first. That is the order `fiber.ts` produces:
// `disposables` ends as [inner effects…, own disposer, self-removal] and dispose does
// `splice(0).reverse()`, so the outer effect's own inverse runs before the effects it created —
// which is right, because its setup created them BEFORE it returned that inverse.
func run(st *state, e *undoable) error {
	st.mu.Lock()
	if e.done {
		st.mu.Unlock()
		return nil
	}
	e.done = true
	owned := e.owned
	st.mu.Unlock()

	err := e.undo()
	if inner := revert(owned); inner != nil {
		return errors.Join(err, inner)
	}
	return err
}

// revert —— apply a slice of inverses newest-first, running every one even if an earlier fails.
//
// Definition 9 forces the order: composing effects accumulates `s ∘ t`, and `s ∘ t` applies `t`
// — the later inverse — first.
//
// **Where this departs from Cordis, and why both are right.** `Fiber._unload` disposes the fiber's
// top-level effects CONCURRENTLY (`Promise.all`), reserving LIFO for the disposers collected within
// one effect. That is licensed rather than sloppy: Theorem 43 says pairwise independent effects
// "reach γ₀ under the order of ANY permutation", and distinct keys are independent outright
// (Theorem 45), so concurrent is one permutation among the allowed ones. LIFO is another, and it is
// the one Definition 9 names — so a port that cannot see whether two effects are independent
// takes the order that is always sound.
//
// Every inverse runs even if an earlier one fails, and the failures come back joined; Cordis does
// the same, logging each rejection separately. Aborting at the first error would strand every
// effect registered before it, turning one stuck inverse into a permanent leak of everything
// underneath.
func revert(entries []*undoable) error {
	var errs []error
	for _, e := range slices.Backward(entries) {
		if e.done {
			continue
		}
		e.done = true
		owned := e.owned
		if err := e.undo(); err != nil {
			errs = append(errs, err)
		}
		if err := revert(owned); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// Unload —— `recover` (Definition 6): apply φ and reset it to the identity.
func (s *Scope) Unload() error {
	st := s.st()
	st.mu.Lock()
	if st.unloaded {
		st.mu.Unlock()
		return nil
	}
	st.unloaded = true
	acc := st.acc
	st.acc = nil
	st.mu.Unlock()

	return revert(acc)
}

// Active —— whether Effect would be accepted here. An unloaded ancestor makes every descendant
// inactive, because the ancestor's accumulator has already run and will not run again.
func (s *Scope) Active() bool {
	st := s.st()
	st.mu.Lock()
	unloaded, parent := st.unloaded, st.parent
	st.mu.Unlock()
	if unloaded {
		return false
	}
	if parent != nil {
		return parent.Active()
	}
	return true
}

// Epoch —— the identity of the bound providers: their uids concatenated in key order, or ""
// when any is missing.
//
// Identity and not presence: a provider swapped for a different one of the same name changes this,
// which is the case a boolean check misses.
func (s *Scope) Epoch() string {
	st := s.st()
	st.mu.Lock()
	defer st.mu.Unlock()
	return epochOf(st.providers)
}

func epochOf(providers map[string]string) string {
	if len(providers) == 0 {
		return ""
	}
	keys := make([]string, 0, len(providers))
	for k := range providers {
		if providers[k] == "" {
			return "" // any missing implementation makes the epoch INACTIVE
		}
		keys = append(keys, k)
	}
	slices.Sort(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(providers[k])
		b.WriteByte(';')
	}
	return b.String()
}

// Bind —— record the provider identities this scope depends on, and report whether the epoch
// moved.
func (s *Scope) Bind(providers map[string]string) bool {
	st := s.st()
	st.mu.Lock()
	defer st.mu.Unlock()
	before := epochOf(st.providers)
	st.providers = maps.Clone(providers)
	return epochOf(st.providers) != before
}
