// deps_wired.go — confirms at startup that every dep group has actually been connected.
//
// The mechanism lives in internal/infra/depcheck (this facade keeps only the declaration
// and the call). Why it's needed, and the consequence of the missing `EmailChange` line
// on 2026-08-31, are written at the top of that package.

package admin

import (
	"reflect"

	"github.com/atmaxmoj/standmeet/internal/infra/depcheck"
)

// AssertDepsWired checks that every dep group has at least one non-nil member. The
// assembly root calls this before it starts serving; a failure means it doesn't start
// (an instance with one missing wire is far harder to debug than one that refuses to boot).
func (h *Handlers) AssertDepsWired() error {
	return depcheck.AllWired(reflect.ValueOf(h).Elem())
}
