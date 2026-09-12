// sequence.go —— the implementation of §3.1.3's effect iterators. Contract: iterator.go.
//
// The whole design is in one field: an Iterator holds the REMAINING step, not the steps taken. That
// is what makes Definition 17's `Maybe(𝔍)` continuation real rather than decorative — the
// boundary between two iterations is a value someone can stop at, and `Unload` there reverts the
// steps taken and nothing more.

package effect

import "errors"

// Iterator —— `𝔍_Γ`: a component's whole loading, as one value.
type Iterator struct {
	next Step
	done bool

	// mark —— where this iterator's contribution to the accumulator begins, recorded at its
	// first iteration. A failing step reverts back to HERE, not to the step before it: Theorem 16.2
	// makes every intermediate state recoverable, and a half-mounted component is what that rules
	// out.
	mark    int
	started bool
}

// Sequence —— build an Iterator from its first Step.
func Sequence(first Step) *Iterator {
	return &Iterator{next: first}
}

// Once —— equation (19): a plain effect embedded as the iterator whose first iteration already
// yields Nothing. The embedding is what keeps `Effect` and `Run` from being two parallel worlds.
func Once(up Setup) *Iterator {
	return &Iterator{next: func() (Dispose, Step, error) {
		undo, err := up()
		return undo, nil, err
	}}
}

// Advance —— take exactly one iteration, composing its inverse onto the accumulator, and report
// whether another remains.
//
// A failing step reverts what the sequence has already installed before returning, the same rule a
// failing Setup obeys one level up.
func (s *Scope) Advance(it *Iterator) (bool, error) {
	if !it.runnable() {
		return false, nil
	}
	if !s.Active() {
		return false, ErrInactive
	}
	it.begin(s)

	undo, more, err := step(it)
	if err != nil {
		return false, joinRollback(s, it.mark, err)
	}
	yield := func() (Dispose, error) { return undo, nil }
	if _, regErr := s.Effect("iteration", yield); regErr != nil {
		return false, regErr
	}
	it.next = more
	it.done = more == nil
	return !it.done, nil
}

// runnable —— is there another iteration to take? `Nothing` and an exhausted iterator both
// answer no, which is Definition 17's Maybe read at the boundary.
func (it *Iterator) runnable() bool {
	return it != nil && !it.done && it.next != nil
}

// begin —— record where this iterator's contribution to the accumulator starts, at its FIRST
// iteration and never again. A failing step reverts back to here, not to the step before it:
// Theorem 16.2 makes every intermediate state recoverable, and a half-mounted component is what
// that rules out.
func (it *Iterator) begin(s *Scope) {
	if it.started {
		return
	}
	st := s.st()
	st.mu.Lock()
	it.mark, it.started = len(st.acc), true
	st.mu.Unlock()
}

// step —— one iteration, held to Definition 17. Three results because that IS the shape of an
// iteration: the inverse, the continuation, and whether it got that far.
//
// step —— one iteration, held to Definition 17: it yields the inverse of what it just did, and
// an iteration that yields none is not one.
//
//nolint:revive // function-result-limit: Definition 17 gives an iteration three results.
func step(it *Iterator) (Dispose, Step, error) {
	undo, more, err := it.next()
	if err == nil && undo == nil {
		err = ErrNoInverse
	}
	if err != nil {
		it.done = true
		return nil, nil, err
	}
	return undo, more, nil
}

// joinRollback —— revert what this run installed, and report the failure alongside any the
// reverting itself produced. The rollback reaches the WHOLE sequence so far, not just the failing
// step: a half-mounted component is the state this file exists to make unrepresentable.
func joinRollback(s *Scope, mark int, cause error) error {
	if err := s.rollbackTo(mark); err != nil {
		return errors.Join(cause, err)
	}
	return cause
}

// Run —— Definition 18: drive the iterator to completion.
func (s *Scope) Run(it *Iterator) error {
	for {
		more, err := s.Advance(it)
		if err != nil {
			return err
		}
		if !more {
			return nil
		}
	}
}
