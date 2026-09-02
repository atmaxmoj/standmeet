// Package depcheck —— confirms at startup that a **hand-copied dependency table** has no
// missing lines.
//
// The wiring between the composition root and the route layer is often a field-by-field
// assignment table (`Foo: deps.Admin.Foo,` × N). A missing line triggers no error anywhere:
// it compiles, lints, and starts fine — until some user hits that path, that dep group turns
// out nil, and it's a **nil-pointer panic**. The 500 the panic produces is usually collapsed
// by an upper layer into one generic error class, so the UI shows the user a completely
// unrelated explanation ("this link is invalid"); acting on that explanation never gets them
// out.
//
// The email-change confirmation flow hit exactly this on 2026-08-31: `EmailChange` was
// missing one line ([[move-the-capability-move-its-edges]]).
//
// **Why reflection instead of writing yet another checklist**: a checklist is exactly the
// kind of thing that just got missed — a table someone has to remember to update. Reflection
// looks at the structure itself, so whoever adds a new dep has nothing extra to do
// ([[structure-means-no-responsibility-class]]).
//
// It lives in infra, not the route layer: a route is a "facade" that should carry only a
// single call, while this mechanism isn't tied to any one route — any hand-copied dependency
// table can use it.
//
// The parameter is `reflect.Value`, not `any`: `any` is banned in this repo, and this code
// needs reflection anyway — making the caller spell out `reflect.ValueOf(x).Elem()` also
// states plainly "this is reflection".
package depcheck

import (
	"fmt"
	"reflect"
	"strings"
)

// AllWired —— every dep group in rv has at least one non-nil member. Pass a struct (not a
// pointer).
//
// The criterion is "all nil", not "any nil": some dep structs legitimately have optional
// members, but **having zero nilable members assigned** can only mean a missing line — no
// valid wiring ever leaves that shape.
func AllWired(rv reflect.Value) error {
	if rv.Kind() != reflect.Struct {
		return fmt.Errorf("depcheck: want a struct, got %s", rv.Kind())
	}
	unwired := unwiredFields(rv)
	if len(unwired) == 0 {
		return nil
	}
	return fmt.Errorf("deps never wired: %s — add the missing line(s) where this struct is built",
		strings.Join(unwired, ", "))
}

func unwiredFields(rv reflect.Value) []string {
	var out []string
	t := rv.Type()
	for i := range rv.NumField() {
		if AllNilMembers(rv.Field(i)) {
			out = append(out, t.Field(i).Name)
		}
	}
	return out
}

// AllNilMembers —— true when f is a dep group and every one of its nilable members is nil.
// Returns false if f isn't a struct, or if it has zero nilable members.
func AllNilMembers(f reflect.Value) bool {
	if f.Kind() != reflect.Struct {
		return false
	}
	nilable := 0
	for _, m := range f.Fields() {
		if !isNilable(m.Kind()) {
			continue
		}
		nilable++
		if !m.IsNil() {
			return false
		}
	}
	return nilable > 0
}

func isNilable(k reflect.Kind) bool {
	return k == reflect.Pointer || k == reflect.Interface || k == reflect.Func || k == reflect.Map
}
