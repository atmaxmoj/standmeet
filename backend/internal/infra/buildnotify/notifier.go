// Package buildnotify is an in-memory broadcast that wakes microsite preview
// long-pollers the moment a build finishes, so the owner's panel follows the agent's
// edits without a fixed poll interval (the "QR-payment" long-poll the owner asked for:
// hold one connection, get answered as soon as there's something to show).
//
// Global (single-owner v1): a build for any owner wakes every waiter. That is safe —
// a woken waiter just refetches its OWN list and re-hangs; it never sees another
// owner's data. ponytail: key by owner_id if multi-tenant waiter volume ever matters.
package buildnotify

import "sync"

// Notifier is a version counter plus a broadcast channel. Waiters capture the current
// version and the channel together (Current), so a Signal landing between the two reads
// can never be lost — the captured channel is the one that Signal closes.
// (ch first so govet fieldalignment sees the only pointer word at offset 0.)
type Notifier struct {
	ch      chan struct{}
	version int64
	mu      sync.Mutex
}

// New returns a ready notifier at version 0.
func New() *Notifier {
	return &Notifier{ch: make(chan struct{})}
}

// Signal records that a build finished: bumps the version and wakes every current waiter.
func (n *Notifier) Signal() {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.version++
	close(n.ch)
	n.ch = make(chan struct{})
}

// Current returns the version now and the channel that closes on the NEXT Signal,
// captured atomically. A waiter compares the version to what it last saw; if unchanged,
// it selects on the channel (and a timeout) for the next build.
func (n *Notifier) Current() (int64, <-chan struct{}) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.version, n.ch
}
