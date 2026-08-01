// check-boundary-thin —— 边界上只许有声明和转交,不许有形状和逻辑。
//
// 两条性质,分别对应两个位置:
//
// # 1. 门面就是门面(internal/<domain>/facade)
//
// facade 只做一件事:把域里的东西**再导出**。所以它只许有别名(`type X = guts.X`)和
// 重导出的 var / const。一旦出现函数体或自己定义的类型,域里和门面上就有了两套说法,
// 而外面的人只看得见门面那套。
//
// # 2. 收口是汇聚,不是能力的家(internal/routes/dispatcher)
//
// 收口该有的全部是:机制(注册、装饰器、Face、Conform、错误类别)加一串 import。
// 能力的声明和它的入参出参形状属于**域**。
//
// 判据是两个精确的信号,不是"感觉太长":
//
//   - 带 json tag 的 struct —— 那是入参 / 出参的形状。形状归域,收口不该有第二套。
//   - json.RawMessage 的 schema 字面量 —— 那是 op 的声明。声明归域。
//
// 为什么不用圈复杂度量这件事:我试过,拦不住。入参 struct、逐字段抄、出参 struct、
// 错误对照表,全都是**长而不分叉**的代码,圈复杂度 1 到 2,≤3 的门笑着放行,5462 行
// 就是这么长出来的。分叉和体积是两回事,得分别量。
//
// # 棘轮
//
// 两条各有一份基线(迁移前就在那儿的文件),**只能变短**。搬走一个资源就删掉对应的行。
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

const (
	internalRoot  = "./internal"
	dispatcherPkg = "internal/routes/dispatcher"
	baselineFile  = "check-boundary-thin-baseline.txt"
	modulePrefix  = "github.com/atmaxmoj/standmeet/internal/"
)

func main() {
	violations, err := scan()
	if err != nil {
		fmt.Fprintln(os.Stderr, "check-boundary-thin:", err)
		os.Exit(2)
	}
	baseline, berr := loadBaseline()
	if berr != nil {
		fmt.Fprintln(os.Stderr, "check-boundary-thin:", berr)
		os.Exit(2)
	}
	report(violations, baseline)
}

// violation —— 一个文件加一句为什么。
type violation struct {
	File string
	Why  string
}

func report(violations []violation, baseline map[string]bool) {
	fresh := []violation{}
	seen := map[string]bool{}
	for _, v := range violations {
		seen[v.File] = true
		if !baseline[v.File] {
			fresh = append(fresh, v)
		}
	}
	if len(fresh) > 0 {
		printFresh(fresh)
		os.Exit(1)
	}
	printSummary(len(baseline), staleCount(baseline, seen))
}

func printFresh(fresh []violation) {
	sort.Slice(fresh, func(i, j int) bool { return fresh[i].File < fresh[j].File })
	fmt.Println("check-boundary-thin: a boundary grew a shape or a rule of its own.")
	fmt.Println("Declarations and payload shapes belong to the domain; the facade")
	fmt.Println("re-exports and the dispatcher aggregates.")
	fmt.Println()
	for _, v := range fresh {
		fmt.Printf("  %s — %s\n", v.File, v.Why)
	}
}

func printSummary(left, stale int) {
	msg := "check-boundary-thin: facades only re-export; the dispatcher only aggregates"
	switch {
	case stale > 0:
		fmt.Printf("%s (%d baselined, %d already clean — delete them from the baseline).\n",
			msg, left, stale)
	case left > 0:
		fmt.Printf("%s (%d baselined left to move into their domain, ratchet holds).\n", msg, left)
	default:
		fmt.Printf("%s (baseline empty).\n", msg)
	}
}

func staleCount(baseline map[string]bool, seen map[string]bool) int {
	n := 0
	for f := range baseline {
		if !seen[f] {
			n++
		}
	}
	return n
}

func scan() ([]violation, error) {
	out := []violation{}
	fset := token.NewFileSet()
	err := filepath.WalkDir(internalRoot, func(path string, d fs.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		if skip(path, d.IsDir()) {
			return nil
		}
		f, perr := parser.ParseFile(fset, path, nil, 0)
		if perr != nil {
			return fmt.Errorf("parse %s: %w", path, perr)
		}
		out = append(out, inspect(filepath.ToSlash(path), f)...)
		return nil
	})
	return out, err
}

func skip(path string, isDir bool) bool {
	return isDir || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go")
}

// inspect —— 按文件所在的位置选规则。两个位置之外的文件不管。
func inspect(path string, f *ast.File) []violation {
	switch {
	case isFacade(path):
		return facadeViolations(path, f)
	case strings.Contains(path, dispatcherPkg):
		return dispatcherViolations(path, f)
	}
	return nil
}

// isFacade —— internal/<domain>/facade/...(正好这一层,routes 下的不算)。
func isFacade(path string) bool {
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(path), "./"), "/")
	return len(parts) == 4 && parts[0] == "internal" && parts[2] == "facade"
}

// facadeViolations —— 门面只许别名和重导出。
func facadeViolations(path string, f *ast.File) []violation {
	out := []violation{}
	for _, decl := range f.Decls {
		if fn, ok := decl.(*ast.FuncDecl); ok {
			out = append(out, violation{path, "facade declares func " + fn.Name.Name})
			continue
		}
		out = append(out, nonAliasTypes(path, decl)...)
	}
	return out
}

func nonAliasTypes(path string, decl ast.Decl) []violation {
	gen, ok := decl.(*ast.GenDecl)
	if !ok || gen.Tok != token.TYPE {
		return nil
	}
	out := []violation{}
	for _, spec := range gen.Specs {
		ts, tsOK := spec.(*ast.TypeSpec)
		if tsOK && !ts.Assign.IsValid() {
			out = append(out, violation{path, "facade defines type " + ts.Name.Name +
				" instead of aliasing the domain's"})
		}
	}
	return out
}

// allowedDispatcherImports —— 收口只认两样本仓的东西:域的正门,和中立词汇。
//
// 它 import 别的任何 internal 包,都意味着能力的实现正在往收口里渗 —— 收口的活是
// **把各域的 facade 汇起来再导出**,不是自己会点什么。
var allowedDispatcherImports = []string{
	"github.com/atmaxmoj/standmeet/internal/infra/facadeparity",
}

// dispatcherViolations —— 收口不许有载荷形状、op 声明,也不许 import 域正门以外的东西。
func dispatcherViolations(path string, f *ast.File) []violation {
	out := dispatcherImportViolations(path, f)
	ast.Inspect(f, func(n ast.Node) bool {
		if ts, ok := n.(*ast.TypeSpec); ok && hasJSONTag(ts) {
			out = append(out, violation{path,
				"declares the payload shape " + ts.Name.Name + " — that belongs to the domain"})
		}
		if vs, ok := n.(*ast.ValueSpec); ok && isRawSchema(vs) {
			out = append(out, violation{path,
				"declares an op input schema — the op belongs to the domain"})
		}
		return true
	})
	return dedupe(out)
}

func dispatcherImportViolations(path string, f *ast.File) []violation {
	out := []violation{}
	for _, imp := range f.Imports {
		p := strings.Trim(imp.Path.Value, `"`)
		if !strings.HasPrefix(p, modulePrefix) || allowedForDispatcher(p) {
			continue
		}
		out = append(out, violation{path, "imports " + p +
			" — the dispatcher may only reach a domain through its facade"})
	}
	return out
}

func allowedForDispatcher(importPath string) bool {
	if isDomainFacade(importPath) {
		return true
	}
	for _, ok := range allowedDispatcherImports {
		if importPath == ok {
			return true
		}
	}
	return false
}

// isDomainFacade —— internal/<domain>/facade,正好三段(routes 下更深的不算)。
func isDomainFacade(importPath string) bool {
	rest := strings.TrimPrefix(importPath, modulePrefix)
	return strings.HasSuffix(rest, "/facade") && strings.Count(rest, "/") == 1
}

func hasJSONTag(ts *ast.TypeSpec) bool {
	st, ok := ts.Type.(*ast.StructType)
	if !ok || st.Fields == nil {
		return false
	}
	for _, field := range st.Fields.List {
		if field.Tag != nil && strings.Contains(field.Tag.Value, "json:") {
			return true
		}
	}
	return false
}

// isRawSchema —— `var x = json.RawMessage(...)`,也就是一个 op 的入参 schema。
func isRawSchema(vs *ast.ValueSpec) bool {
	for _, v := range vs.Values {
		call, ok := v.(*ast.CallExpr)
		if !ok {
			continue
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if ok && sel.Sel.Name == "RawMessage" {
			return true
		}
	}
	return false
}

func dedupe(in []violation) []violation {
	seen := map[string]bool{}
	out := []violation{}
	for _, v := range in {
		key := v.File + "|" + v.Why
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, v)
	}
	return out
}

func loadBaseline() (map[string]bool, error) {
	here, err := os.Executable()
	if err != nil {
		return nil, err
	}
	_ = here
	raw, rerr := os.ReadFile(baselinePath())
	if rerr != nil {
		return nil, fmt.Errorf("read baseline: %w", rerr)
	}
	out := map[string]bool{}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		out[line] = true
	}
	return out, nil
}

// baselinePath —— 基线跟脚本放一起(仓库里),不跟着编译产物走。
func baselinePath() string {
	return filepath.Join("..", "infra", "scripts", "check-boundary-thin", baselineFile)
}
