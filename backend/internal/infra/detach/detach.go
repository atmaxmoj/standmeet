// Package detach — process-local background work that must outlive the request that started it.
//
// Only infra and the composition root start goroutines (gate: check-no-bare-goroutine.sh). Work
// whose effect is durable goes on a job (internal/infra/jobs). Work whose effect lives only in
// this process's memory — warming an in-process cache — comes here: a job could run in another
// process or after a restart, where the cache it fills does not exist.
package detach

import "log/slog"

// Go — runs fn on its own goroutine. fn bounds its own run time. A panic in fn is logged and
// stops there: detached work must not crash the process.
func Go(name string, fn func()) {
	go func() {
		defer func() {
			if p := recover(); p != nil {
				slog.Error("detached work panicked", "name", name, "panic", p)
			}
		}()
		fn()
	}()
}
