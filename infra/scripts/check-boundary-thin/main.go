// check-boundary-thin —— a boundary may only hold declarations and hand-off,
// never shapes or logic.
//
// Two properties, one per location:
//
// # 1. A facade is only a facade (internal/<domain>/facade)
//
// A facade does exactly one thing: **re-export** the domain's own things. So
// it may only hold aliases (`type X = guts.X`) and re-exported var / const.
// The moment a func body or a self-defined type shows up, the domain and the
// facade now tell two different stories — and outsiders can only see the
// facade's version.
//
// # 2. The dispatcher aggregates; it is not home to any capability
// (internal/routes/dispatcher)
//
// The dispatcher should hold exactly: mechanism (registration, decorators,
// Face, Conform, error categories) plus a list of imports. A capability's
// declaration and its input/output payload shape belong to the **domain**.
//
// The criterion is two precise signals, not a vague "feels too long":
//
//   - A struct with json tags — that's an input/output shape. Shapes belong
//     to the domain; the dispatcher must not hold a second copy.
//   - A json.RawMessage schema literal — that's an op's declaration. The
//     declaration belongs to the domain.
//
// Why not just measure cyclomatic complexity: tried it, doesn't catch this.
// Input structs, field-by-field copying, output structs, error lookup
// tables — all of it is **long but not branchy** code, cyclomatic
// complexity 1 to 2, sailing past any gate set at ≤3. That's how 5462 lines
// piled up. Branching and volume are two different things and need two
// different measures.
//
// # Ratchet
//
// Each of the two rules carries its own baseline (files that were already
// there before the migration), and it may **only shrink**. Move a resource
// out and delete its line from the baseline.
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

// violation —— a file plus one sentence saying why.
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

// inspect —— pick the rule by where the file sits. Files outside both
// locations are ignored.
func inspect(path string, f *ast.File) []violation {
	switch {
	case isFacade(path):
		return facadeViolations(path, f)
	case strings.Contains(path, dispatcherPkg):
		return dispatcherViolations(path, f)
	}
	return nil
}

// isFacade —— internal/<domain>/facade/... (exactly this depth; anything
// under routes doesn't count).
func isFacade(path string) bool {
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(path), "./"), "/")
	return len(parts) == 4 && parts[0] == "internal" && parts[2] == "facade"
}

// facadeViolations —— a facade may only hold aliases and re-exports.
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

// allowedDispatcherImports —— the dispatcher recognizes only two kinds of
// things from this repo: a domain's front door, and neutral vocabulary.
//
// If it imports any other internal package, that means a capability's
// implementation is leaking into the dispatcher — the dispatcher's job is
// **to gather each domain's facade and re-export it**, not to know how to
// do anything on its own.
var allowedDispatcherImports = []string{
	"github.com/atmaxmoj/standmeet/internal/infra/facadeparity",
}

// dispatcherViolations —— the dispatcher must not hold a payload shape or an
// op declaration, and must not import anything beyond a domain's front door.
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

// isDomainFacade —— internal/<domain>/facade, exactly three segments
// (anything deeper under routes doesn't count).
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

// isRawSchema —— `var x = json.RawMessage(...)`, i.e. an op's input schema.
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

// baselinePath —— the baseline lives next to the script (in the repo), not
// alongside the build output.
func baselinePath() string {
	return filepath.Join("..", "infra", "scripts", "check-boundary-thin", baselineFile)
}
