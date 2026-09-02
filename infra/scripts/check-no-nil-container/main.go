// check-no-nil-container —— enforces item 2 of [[project-principles]]:
// a container-typed return value (slice / map / chan) must never be nil.
//
// Rules:
//   - func's return type is []T / map[K]V / chan T -> that return position must not be nil
//   - if the same return statement has an error position that's non-nil -> the whole
//     statement counts as an error path, and every container position is allowed to be nil
//   - *T / interface / single-value string, etc., are out of scope
//
// AST-only implementation, pulling in neither go/types nor
// golang.org/x/tools/go/packages —— in our code, slice/map/chan are always written
// as literals directly, none hidden behind a type alias, so plain AST literal
// recognition is accurate enough.
//
// Known false-negative cases (acceptable):
//   - a returned call result `return f()` can't be statically checked for whether f() returns nil
//   - naked return (named return values not listed explicitly) — rarely used for container returns
//   - function literals / closures — not scanned; things like the sort.Slice less func in
//     retriever don't return a container anyway
//
// Usage:
//
//	go run ./cmd/check-no-nil-container ./internal ./cmd
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

// scanRoots —— hardcoded scan roots, the project's two source root directories.
// Doesn't read os.Args / env: avoids gosec G703 flagging root as tainted untrusted
// user input. To add a new root, edit the source here and recompile.
var scanRoots = []string{"./internal", "./cmd"}

func main() {
	totals, err := scanAllRoots()
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "check-no-nil-container:", err)
		os.Exit(2)
	}
	if totals.violations > 0 {
		failOut()
		os.Exit(1)
	}
	if _, ferr := fmt.Fprintf(os.Stdout,
		"check-no-nil-container: %d files scanned, all comply.\n", totals.scanned); ferr != nil {
		os.Exit(2)
	}
}

// scanAllRoots —— walks scanRoots, aggregating scanned/violations, and passes the
// first walk error straight up (so main handles os.Exit in one place). Returns
// walkState rather than a bare (int, int), to avoid confusing-results.
func scanAllRoots() (walkState, error) {
	fset := token.NewFileSet()
	totals := walkState{}
	for _, root := range scanRoots {
		state, err := walk(fset, root)
		if err != nil {
			return totals, err
		}
		totals.scanned += state.scanned
		totals.violations += state.violations
	}
	return totals, nil
}

func failOut() {
	_, _ = fmt.Fprintln(os.Stderr, "")
	_, _ = fmt.Fprintln(os.Stderr,
		"Container types (slice/map/chan) must never return nil — return empty container.")
	_, _ = fmt.Fprintln(os.Stderr,
		"Project principle: optional uses *T; collections always return empty.")
}

// walkState —— aggregates walk's multiple results, avoiding a 3-value return
// that would trip function-result-limit.
type walkState struct {
	scanned    int
	violations int
}

func walk(fset *token.FileSet, root string) (walkState, error) {
	s := walkState{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, werr error) error {
		return walkOne(fset, &s, path, d, werr)
	})
	if err != nil {
		return s, fmt.Errorf("walkdir: %w", err)
	}
	return s, nil
}

// walkOne —— handles a single entry; split out to lower walk's cognitive complexity.
func walkOne(
	fset *token.FileSet, s *walkState, path string, d fs.DirEntry, werr error,
) error {
	if werr != nil {
		return fmt.Errorf("walk %s: %w", path, werr)
	}
	if d.IsDir() || !shouldScan(path) {
		return nil
	}
	s.scanned++
	v, perr := scanFile(fset, path)
	if perr != nil {
		return perr
	}
	s.violations += v
	return nil
}

// shouldScan —— whether this path should be scanned (excludes _test, sql.go
// generated code, wire_gen.go, dbq/models.go).
func shouldScan(path string) bool {
	if !strings.HasSuffix(path, ".go") {
		return false
	}
	if isGeneratedGo(path) {
		return false
	}
	return filepath.Base(path) != "wire_gen.go"
}

// isGeneratedGo —— checks whether path is _test.go / sqlc-generated / dbq models.
func isGeneratedGo(path string) bool {
	if strings.HasSuffix(path, "_test.go") || strings.HasSuffix(path, ".sql.go") {
		return true
	}
	base := filepath.Base(path)
	return base == "models.go" && strings.Contains(path, "/dbq/")
}

func scanFile(fset *token.FileSet, path string) (int, error) {
	file, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", path, err)
	}
	violations := 0
	ast.Inspect(file, func(n ast.Node) bool {
		fd, ok := n.(*ast.FuncDecl)
		if !ok || fd.Body == nil || fd.Type.Results == nil {
			return true
		}
		violations += checkFunc(fset, fd)
		return true
	})
	return violations, nil
}

// checkFunc walks one FuncDecl, looking at each ReturnStmt for nil
// container violations.
func checkFunc(fset *token.FileSet, fd *ast.FuncDecl) int {
	return checkBody(fset, fd.Name.Name, fd.Type, fd.Body)
}

// checkBody —— one function's returns, checked against ITS OWN signature.
//
// A nested func literal gets its own pass and stops the outer walk. Without that, a closure's
// `return nil` (an error result, perfectly legal) was reported against the ENCLOSING function's
// results — so `func Jobs() []Job { return []Job{Named(..., func(ctx) error { ... return nil })} }`
// was flagged as "Jobs returns nil". A checker that reports a violation the source does not
// contain teaches people to route around it.
func checkBody(fset *token.FileSet, name string, ft *ast.FuncType, body *ast.BlockStmt) int {
	if body == nil || ft.Results == nil {
		return checkNestedOnly(fset, name, body)
	}
	resultTypes := flattenResults(ft.Results.List)
	violations := 0
	ast.Inspect(body, func(n ast.Node) bool {
		if lit, isLit := n.(*ast.FuncLit); isLit {
			violations += checkBody(fset, name, lit.Type, lit.Body)
			return false // its returns belong to ITS signature, not ours
		}
		rs, ok := n.(*ast.ReturnStmt)
		if !ok || len(rs.Results) == 0 {
			return true
		}
		violations += checkReturn(fset, name, resultTypes, rs)
		return true
	})
	return violations
}

// checkNestedOnly —— a body whose own signature has no results still has to be walked: a closure
// inside it can return containers.
func checkNestedOnly(fset *token.FileSet, name string, body *ast.BlockStmt) int {
	if body == nil {
		return 0
	}
	violations := 0
	ast.Inspect(body, func(n ast.Node) bool {
		lit, isLit := n.(*ast.FuncLit)
		if !isLit {
			return true
		}
		violations += checkBody(fset, name, lit.Type, lit.Body)
		return false
	})
	return violations
}

// returnPosCheckable —— whether this ReturnStmt can undergo a positional container-nil check.
func returnPosCheckable(resultTypes []ast.Expr, rs *ast.ReturnStmt) bool {
	if len(rs.Results) != len(resultTypes) {
		// single-call multi-return ("return f()") — can't analyze positionally.
		return false
	}
	return !hasNonNilErrorReturn(resultTypes, rs.Results)
}

// checkReturn —— the container-nil check for a single ReturnStmt; split out to
// lower checkFunc's cognitive complexity.
func checkReturn(
	fset *token.FileSet, name string, resultTypes []ast.Expr, rs *ast.ReturnStmt,
) int {
	if !returnPosCheckable(resultTypes, rs) {
		return 0
	}
	violations := 0
	for i, t := range resultTypes {
		if isContainerType(t) && isNilIdent(rs.Results[i]) {
			pos := fset.Position(rs.Pos())
			_, _ = fmt.Fprintf(os.Stderr,
				"%s:%d: %s returns nil for %s at position %d — return empty %s instead\n",
				pos.Filename, pos.Line, name,
				exprString(t), i, exprString(t))
			violations++
		}
	}
	return violations
}

// flattenResults expands `func() (a, b string, c int)` to per-position
// type slice [string, string, int].
func flattenResults(fields []*ast.Field) []ast.Expr {
	out := make([]ast.Expr, 0, len(fields))
	for _, f := range fields {
		n := len(f.Names)
		if n == 0 {
			n = 1
		}
		for range n {
			out = append(out, f.Type)
		}
	}
	return out
}

func hasNonNilErrorReturn(types, exprs []ast.Expr) bool {
	for i, t := range types {
		if isErrorType(t) && !isNilIdent(exprs[i]) {
			return true
		}
	}
	return false
}

func isContainerType(t ast.Expr) bool {
	switch typ := t.(type) {
	case *ast.ArrayType:
		// Slice = ArrayType with no length; Array = with length.
		return typ.Len == nil
	case *ast.MapType, *ast.ChanType:
		return true
	}
	return false
}

func isErrorType(t ast.Expr) bool {
	id, ok := t.(*ast.Ident)
	return ok && id.Name == "error"
}

func isNilIdent(e ast.Expr) bool {
	id, ok := e.(*ast.Ident)
	return ok && id.Name == "nil"
}

// exprPrimitive —— non-container types (Ident / Star / Selector). Split out to
// lower exprString's cyclomatic complexity. Interface / Func go through exprLiteral.
func exprPrimitive(e ast.Expr) (string, bool) {
	switch t := e.(type) {
	case *ast.Ident:
		return t.Name, true
	case *ast.StarExpr:
		return "*" + exprString(t.X), true
	case *ast.SelectorExpr:
		return exprString(t.X) + "." + t.Sel.Name, true
	}
	return exprLiteral(e)
}

// exprLiteral —— types that render as a fixed literal (interface / func).
func exprLiteral(e ast.Expr) (string, bool) {
	switch e.(type) {
	case *ast.InterfaceType:
		return "interface{...}", true
	case *ast.FuncType:
		return "func(...)", true
	}
	return "", false
}

func exprString(e ast.Expr) string {
	switch t := e.(type) {
	case *ast.ArrayType:
		return arrayString(t)
	case *ast.MapType:
		return "map[" + exprString(t.Key) + "]" + exprString(t.Value)
	case *ast.ChanType:
		return "chan " + exprString(t.Value)
	}
	if s, ok := exprPrimitive(e); ok {
		return s
	}
	return "?"
}

func arrayString(t *ast.ArrayType) string {
	if t.Len == nil {
		return "[]" + exprString(t.Elt)
	}
	return "[N]" + exprString(t.Elt)
}
