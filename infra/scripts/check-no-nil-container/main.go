// check-no-nil-container —— 强制 [[project-principles]] 的第 2 条：
// 容器类型 (slice / map / chan) 返回值永远不能是 nil。
//
// 规则：
//   - func 返回类型是 []T / map[K]V / chan T → 对应 return position 不可为 nil
//   - 如果同一 return 里有 error 位置且非 nil → 整条算 error path，所有 container
//     位置允许 nil
//   - *T / interface / 单值 string 等不在管辖范围
//
// AST-only 实现，不引 go/types 也不引 golang.org/x/tools/go/packages —— 我们
// 的代码里 slice/map/chan 直接 literal 写出来，没有 type alias 隐藏的，纯
// AST 字面识别足够准。
//
// 漏报场景（已知，可接受）：
//   - 返函数调用结果 `return f()` 没法静态判断 f() 是否返 nil
//   - naked return（命名返回值不显式列）—— 极少用于 container 返回
//   - 函数字面 / 闭包 —— 不扫描，retriever 里的 sort.Slice less func 这类
//     不会返 container
//
// 用法：
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

// scanRoots —— hardcoded scan roots，项目源码的两个根目录。
// 不读 os.Args / env：避免 gosec G703 把 root 当 untrusted user input 标 taint。
// 想加新 root 在这里改源码 + recompile。
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

// scanAllRoots —— 遍历 scanRoots，聚合 scanned/violations，第一个 walk 错原样
// 上抛 (让 main 集中 os.Exit)。返 walkState 而不是裸 (int, int)，避免
// confusing-results。
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

// walkState —— walk 返多结果的聚合，避免返 3 值踩 function-result-limit。
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

// walkOne —— 单条 entry 处理；split 出来降 walk 的 cognitive complexity。
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

// shouldScan —— 是否扫描该 path（剔 _test、sql.go 生成代码、wire_gen.go、
// dbq/models.go）。
func shouldScan(path string) bool {
	if !strings.HasSuffix(path, ".go") {
		return false
	}
	if isGeneratedGo(path) {
		return false
	}
	return filepath.Base(path) != "wire_gen.go"
}

// isGeneratedGo —— path 是 _test.go / sqlc 生成 / dbq models 的判断。
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

// returnPosCheckable —— ReturnStmt 是否可做 positional 容器-nil 检查。
func returnPosCheckable(resultTypes []ast.Expr, rs *ast.ReturnStmt) bool {
	if len(rs.Results) != len(resultTypes) {
		// single-call multi-return ("return f()") — can't analyze positionally.
		return false
	}
	return !hasNonNilErrorReturn(resultTypes, rs.Results)
}

// checkReturn —— 单个 ReturnStmt 的容器-nil 检查；split 出来降 checkFunc 认知复杂度。
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

// exprPrimitive —— 非 container 类型（Ident / Star / Selector）。拆出来降
// exprString 的 cyclomatic。Interface / Func 走 exprLiteral。
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

// exprLiteral —— 输出为固定字面量的类型（interface / func）。
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
