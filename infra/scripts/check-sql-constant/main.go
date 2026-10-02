// check-sql-constant —— SQL text is written in the source, never assembled from runtime strings.
//
// A value goes in as a $n parameter. A name the statement needs at runtime (a block's schema, a
// NOTIFY channel) goes in only through sqltext.Format, which quotes it as an identifier. So no
// runtime string can become SQL.
//
// Why a checker of our own: gosec's SQL rules (G201/G202) only watch database/sql calls, and
// this code talks to Postgres through pgx — `fmt.Sprintf("DELETE FROM %s.records …", schema)`
// passed every lint (found 2026-10-02, after the owner asked for injection protection).
//
// Rules, per non-test, non-generated file under ./internal and ./cmd:
//  1. fmt.Sprintf / fmt.Sprint whose literal looks like SQL → violation. Use sqltext.Format.
//  2. `a + b` where some operand is an SQL-looking literal and another operand is not a string
//     literal or a const → violation (a const built from consts stays source text).
//  3. sqltext.Format's template must be a string literal or a const.
//
// AST only (stdlib): "is it a const" is answered from the const declarations of the same package
// directory. Known blind spots: SQL built with strings.Builder / strings.Join, or a const from
// another package used in a concatenation (reported, so it errs to red, not to green).
package main

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// scanRoots —— the backend's source roots (CWD=backend). Fixed, not from argv (gosec G703).
var scanRoots = []string{"./internal", "./cmd"}

// sqltextDir —— the one package allowed to put a runtime name into SQL text.
const sqltextDir = "internal/infra/sqltext"

// sqlLike —— a literal that reads as SQL: an upper-case statement keyword or clause.
var sqlLike = regexp.MustCompile(
	`\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE (TABLE|SCHEMA|INDEX)|DROP (TABLE|SCHEMA|INDEX)` +
		`|ALTER TABLE|TRUNCATE|LISTEN|NOTIFY|WHERE|FROM)\b`)

type finding struct {
	pos token.Position
	why string
}

func main() {
	dirs, err := goDirs()
	if err != nil {
		fail(err)
	}
	var found []finding
	files := 0
	for _, dir := range dirs {
		n, f, derr := scanDir(dir)
		if derr != nil {
			fail(derr)
		}
		files += n
		found = append(found, f...)
	}
	if files < 100 {
		fail(fmt.Errorf("scanned only %d Go files — the scan is blind, not the tree clean", files))
	}
	report(found, files)
}

func fail(err error) {
	_, _ = fmt.Fprintln(os.Stderr, "check-sql-constant:", err)
	os.Exit(2)
}

func report(found []finding, files int) {
	if len(found) == 0 {
		_, _ = fmt.Fprintf(os.Stdout,
			"check-sql-constant: %d files scanned; all SQL text is source text.\n", files)
		return
	}
	sort.Slice(found, func(i, j int) bool { return found[i].pos.String() < found[j].pos.String() })
	for _, f := range found {
		_, _ = fmt.Fprintf(os.Stderr, "%s: %s\n", f.pos, f.why)
	}
	_, _ = fmt.Fprintln(os.Stderr, "check-sql-constant: SQL text must be written in the source."+
		" Pass values as $n parameters; put a runtime name in only through sqltext.Format.")
	os.Exit(1)
}

// goDirs —— every directory under the roots that holds Go files.
func goDirs() ([]string, error) {
	seen := map[string]bool{}
	for _, root := range scanRoots {
		err := filepath.WalkDir(root, func(path string, d os.DirEntry, werr error) error {
			if werr != nil {
				return werr
			}
			if !d.IsDir() && scannable(path) {
				seen[filepath.Dir(path)] = true
			}
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("walk %s: %w", root, err)
		}
	}
	dirs := make([]string, 0, len(seen))
	for d := range seen {
		dirs = append(dirs, d)
	}
	sort.Strings(dirs)
	return dirs, nil
}

// scannable —— hand-written Go: not a test, not sqlc output (its SQL is a const anyway).
func scannable(path string) bool {
	return strings.HasSuffix(path, ".go") && !strings.HasSuffix(path, "_test.go") &&
		!strings.HasSuffix(path, ".sql.go")
}

// scanDir —— one package directory: its consts first, then every file against them.
func scanDir(dir string) (int, []finding, error) {
	if filepath.ToSlash(filepath.Clean(dir)) == sqltextDir {
		return 0, []finding{}, nil
	}
	fset := token.NewFileSet()
	files, err := parseDir(fset, dir)
	if err != nil {
		return 0, nil, err
	}
	consts := constNames(files)
	var found []finding
	for _, f := range files {
		found = append(found, scanFile(fset, f, consts)...)
	}
	return len(files), found, nil
}

func parseDir(fset *token.FileSet, dir string) ([]*ast.File, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", dir, err)
	}
	files := make([]*ast.File, 0, len(entries))
	for _, e := range entries {
		path := filepath.Join(dir, e.Name())
		if e.IsDir() || !scannable(path) {
			continue
		}
		f, perr := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if perr != nil {
			return nil, fmt.Errorf("parse %s: %w", path, perr)
		}
		files = append(files, f)
	}
	return files, nil
}

// constNames —— every name declared `const` anywhere in the package's files.
func constNames(files []*ast.File) map[string]bool {
	out := map[string]bool{}
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			if g, ok := n.(*ast.GenDecl); ok && g.Tok == token.CONST {
				addSpecNames(out, g)
			}
			return true
		})
	}
	return out
}

func addSpecNames(out map[string]bool, g *ast.GenDecl) {
	for _, s := range g.Specs {
		if vs, ok := s.(*ast.ValueSpec); ok {
			for _, n := range vs.Names {
				out[n.Name] = true
			}
		}
	}
}

func scanFile(fset *token.FileSet, f *ast.File, consts map[string]bool) []finding {
	var found []finding
	ast.Inspect(f, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.CallExpr:
			found = append(found, checkCall(fset, x, consts)...)
		case *ast.BinaryExpr:
			if x.Op == token.ADD && sqlInside(x) {
				if !sourceText(x, consts) {
					found = append(found, finding{fset.Position(x.Pos()),
						"SQL text concatenated with a runtime string"})
				}
				return false // the outermost `+` is the one statement; don't report its parts again
			}
		}
		return true
	})
	return found
}

func checkCall(fset *token.FileSet, c *ast.CallExpr, consts map[string]bool) []finding {
	pkg, name := callee(c)
	switch {
	case pkg == "fmt" && (name == "Sprintf" || name == "Sprint") && anySQLArg(c):
		return []finding{{fset.Position(c.Pos()), "SQL text built with fmt." + name}}
	case pkg == "sqltext" && len(c.Args) > 0 && !sourceText(c.Args[0], consts):
		return []finding{{fset.Position(c.Pos()), "sqltext." + name + " template is not source text"}}
	}
	return []finding{}
}

func callee(c *ast.CallExpr) (string, string) {
	sel, ok := c.Fun.(*ast.SelectorExpr)
	if !ok {
		return "", ""
	}
	id, ok := sel.X.(*ast.Ident)
	if !ok {
		return "", ""
	}
	return id.Name, sel.Sel.Name
}

func anySQLArg(c *ast.CallExpr) bool {
	for _, a := range c.Args {
		if s, ok := literal(a); ok && sqlLike.MatchString(s) {
			return true
		}
	}
	return false
}

// sqlInside —— some string literal in this `+` chain reads as SQL.
func sqlInside(e ast.Expr) bool {
	if s, ok := literal(e); ok {
		return sqlLike.MatchString(s)
	}
	if b, ok := e.(*ast.BinaryExpr); ok && b.Op == token.ADD {
		return sqlInside(b.X) || sqlInside(b.Y)
	}
	if p, ok := e.(*ast.ParenExpr); ok {
		return sqlInside(p.X)
	}
	return false
}

// sourceText —— the expression is fixed at compile time: literals, consts, and `+` of those.
func sourceText(e ast.Expr, consts map[string]bool) bool {
	switch x := e.(type) {
	case *ast.BasicLit:
		return x.Kind == token.STRING
	case *ast.Ident:
		return consts[x.Name]
	case *ast.ParenExpr:
		return sourceText(x.X, consts)
	case *ast.BinaryExpr:
		return x.Op == token.ADD && sourceText(x.X, consts) && sourceText(x.Y, consts)
	}
	return false
}

func literal(e ast.Expr) (string, bool) {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	s, err := strconv.Unquote(lit.Value)
	return s, err == nil
}
