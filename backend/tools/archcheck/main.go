// archcheck —— the structural gates over internal/'s import graph, in Go.
//
// These checks used to be python3 one-shots wedged into shell scripts. That was wrong twice over:
// this is a Go repo whose gates parse Go imports (go/parser reads them exactly, where a regex only
// mostly does), and python3 is a third-language runtime the lint image does not carry — which broke
// `make lint` inside Docker while it passed on the host, hidden for as long as BuildKit kept
// the lint layer warm. In Go a gate cannot fail for want of an interpreter: if it builds, it runs.
//
// Modes (one per historical script; the shell wrappers keep the self-tests that prove each bites):
//
//	acyclic   —— the domain-level dependency graph must be a DAG.
//	layering  —— inside a faceted domain, DDD layers only import downward.
//	facade    —— outside code reaches a faceted domain only through its facade.
//
// Each mode returns findings; main prints them and owns the exit code (0 clean, 1 violations,
// 2 the gate could not run — never a silent pass).
package main

import (
	"fmt"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

const modulePrefix = "github.com/atmaxmoj/standmeet/internal/"

// domains —— the 8 core modules from the class diagram + the capability axis. infra (leaf) and
// routes (top) have their own gates (check-infra-not-domain / check-routes-not-imported).
var domains = []string{
	"corpus", "conversation", "connector", "access", "owner",
	"security", "marketplace", "stats", "capabilities",
}

// submodules —— sub-packages that keep their OWN boundary: not a domain's DDD guts, but
// aggregators/plugins hanging off it with their own entry points (owner/ownercore is the owner-MCP
// cap bundle, owner/jobs the job loop, corpus/obsidian vault I/O, conversation/inference the agent
// engine). Both the facade gate and the acyclic gate treat this same set as separate nodes —
// otherwise an aggregator that legitimately spans domains forges a false cycle onto the core it
// merely sits beside. Each domain's core must still be a clean node.
var submodules = map[string]bool{
	"jobs": true, "inference": true, "obsidian": true, "ownercore": true,
}

// layerOf —— the DDD layer order inside one domain (low → high). A file in layer L may import a
// sibling subpackage of the SAME domain only from a strictly LOWER layer.
var layerOf = map[string]int{
	"entity": 0, "db": 0, "infra": 0, "repo": 1, "service": 2, "usecase": 3, "facade": 4,
}

// result —— what a gate found. Clean = no findings; headline is the all-clear or failure banner.
type result struct {
	headline string
	findings []string
}

func main() {
	if len(os.Args) != 3 {
		fail("usage: archcheck <acyclic|layering|facade> <internal-dir>")
	}
	mode, internal := os.Args[1], os.Args[2]
	gate, ok := map[string]func(string) (result, error){
		"acyclic": checkAcyclic, "layering": checkLayering, "facade": checkFacade,
	}[mode]
	if !ok {
		fail(fmt.Sprintf("archcheck: unknown mode %q", mode))
	}
	res, err := gate(internal)
	if err != nil {
		fail(fmt.Sprintf("archcheck %s: %v", mode, err))
	}
	fmt.Println(res.headline) //nolint:forbidigo // a CLI gate's report medium is stdout
	for _, f := range res.findings {
		fmt.Println(f) //nolint:forbidigo // a CLI gate's report medium is stdout
	}
	if len(res.findings) > 0 {
		os.Exit(1)
	}
}

// fail —— the gate could not run (bad usage / unreadable tree). Exit 2, distinct from "violations
// found", so a broken gate can never be mistaken for a clean one.
func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(2)
}

// goFile —— one scanned file: where it sits and what it imports (internal/ paths only).
type goFile struct {
	rel     string // path relative to internal/
	dir     string // directory relative to internal/
	imports []importRef
}

// importRef —— an internal/ import, split into its domain and first sub-package.
type importRef struct{ domain, sub string }

// scan —— walk internal/ and parse every .go file's imports. skipTests drops _test.go files.
func scan(internal string, skipTests bool) ([]goFile, error) {
	var out []goFile
	fset := token.NewFileSet()
	walk := func(path string, d os.DirEntry, err error) error {
		switch {
		case err != nil:
			return err
		case d.IsDir() || !strings.HasSuffix(d.Name(), ".go"):
			return nil
		case skipTests && strings.HasSuffix(d.Name(), "_test.go"):
			return nil
		}
		gf, perr := parseFile(fset, internal, path)
		if perr != nil {
			return perr
		}
		out = append(out, gf)
		return nil
	}
	if err := filepath.WalkDir(internal, walk); err != nil {
		return nil, fmt.Errorf("scan %s: %w", internal, err)
	}
	return out, nil
}

// parseFile —— one file's internal/ imports. An unparseable file fails the gate rather than being
// skipped: skipping would silently shrink the scanned set, which is a false green.
func parseFile(fset *token.FileSet, internal, path string) (goFile, error) {
	f, err := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
	if err != nil {
		return goFile{}, fmt.Errorf("parse %s: %w", path, err)
	}
	rel, rerr := filepath.Rel(internal, path)
	if rerr != nil {
		return goFile{}, fmt.Errorf("relativise %s: %w", path, rerr)
	}
	gf := goFile{rel: rel, dir: filepath.Dir(rel)}
	for _, imp := range f.Imports {
		p := strings.Trim(imp.Path.Value, `"`)
		if !strings.HasPrefix(p, modulePrefix) {
			continue
		}
		parts := strings.Split(strings.TrimPrefix(p, modulePrefix), "/")
		ref := importRef{domain: parts[0]}
		if len(parts) > 1 {
			ref.sub = parts[1]
		}
		gf.imports = append(gf.imports, ref)
	}
	return gf, nil
}

// facetedDomains —— domains that opted in by growing an internal/<domain>/facade/ dir.
func facetedDomains(internal string) []string {
	entries, err := os.ReadDir(internal)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		if e.IsDir() && isDir(filepath.Join(internal, e.Name(), "facade")) {
			out = append(out, e.Name())
		}
	}
	slices.Sort(out)
	return out
}

func isDir(path string) bool {
	st, err := os.Stat(path)
	return err == nil && st.IsDir()
}

// topDir / nodeFor —— which domain a file sits in, and which graph node it belongs to.
func topDir(dir string) string { return strings.Split(dir, string(filepath.Separator))[0] }

func nodeFor(domain, dir string) string {
	parts := strings.Split(dir, string(filepath.Separator))
	if len(parts) > 1 && submodules[parts[1]] {
		return domain + "/" + parts[1]
	}
	return domain
}

func checkAcyclic(internal string) (result, error) {
	files, err := scan(internal, true)
	if err != nil {
		return result{}, err
	}
	edges := acyclicNodes(internal)
	for _, f := range files {
		domain := topDir(f.dir)
		if edges[domain] == nil {
			continue
		}
		src := nodeFor(domain, f.dir)
		for _, imp := range f.imports {
			if dst, ok := acyclicDst(edges, imp); ok && dst != src {
				edges[src][dst] = true
			}
		}
	}
	cycles := findCycles(edges)
	if len(cycles) > 0 {
		res := result{headline: "check-domain-acyclic: internal/ domain-level dependencies have a " +
			"cycle —— layering not sorted out, break the cycle first:"}
		for _, c := range cycles {
			res.findings = append(res.findings, "  CYCLE: "+strings.Join(c, " -> "))
		}
		return res, nil
	}
	return result{headline: fmt.Sprintf("check-domain-acyclic: %d domain/sub-module nodes, "+
		"dependency graph is acyclic (DAG holds).", len(edges))}, nil
}

// acyclicNodes —— the node set: every domain + each own-boundary sub-module present on disk.
func acyclicNodes(internal string) map[string]map[string]bool {
	edges := map[string]map[string]bool{}
	for _, d := range domains {
		edges[d] = map[string]bool{}
		for sub := range submodules {
			if isDir(filepath.Join(internal, d, sub)) {
				edges[d+"/"+sub] = map[string]bool{}
			}
		}
	}
	return edges
}

// acyclicDst —— resolve an import to its node, preferring a sub-module node when one exists.
func acyclicDst(edges map[string]map[string]bool, imp importRef) (string, bool) {
	if edges[imp.domain] == nil {
		return "", false
	}
	if sub := imp.domain + "/" + imp.sub; submodules[imp.sub] && edges[sub] != nil {
		return sub, true
	}
	return imp.domain, true
}

// findCycles —— DFS with a grey/black colouring; reports each back-edge as a cycle path.
func findCycles(edges map[string]map[string]bool) [][]string {
	const white, grey, black = 0, 1, 2
	color := map[string]int{}
	var cycles [][]string
	var stack []string
	var dfs func(string)
	dfs = func(u string) {
		color[u] = grey
		stack = append(stack, u)
		for _, v := range sortedNeighbours(edges[u]) {
			if color[v] == grey {
				if i := slices.Index(stack, v); i >= 0 {
					cycles = append(cycles, append(slices.Clone(stack[i:]), v))
				}
				continue
			}
			if color[v] == white {
				dfs(v)
			}
		}
		color[u] = black
		stack = stack[:len(stack)-1]
	}
	for _, n := range sortedNodes(edges) {
		if color[n] == white {
			dfs(n)
		}
	}
	return cycles
}

// sortedNodes / sortedNeighbours —— deterministic iteration order (two concrete helpers rather
// than one generic, so the tool never needs the banned bare `any`).
func sortedNodes(m map[string]map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

func sortedNeighbours(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

func checkLayering(internal string) (result, error) {
	files, err := scan(internal, false)
	if err != nil {
		return result{}, err
	}
	faceted := facetedDomains(internal)
	var bad []string
	for _, f := range files {
		bad = append(bad, layerViolations(f, faceted)...)
	}
	slices.Sort(bad)
	bad = slices.Compact(bad)
	if len(bad) > 0 {
		return result{
			headline: "check-domain-layering: a domain's DDD layer reaches sideways/up " +
				"(must only import lower layers):",
			findings: bad,
		}, nil
	}
	return result{headline: "check-domain-layering: DDD layer order holds in every faceted " +
		"domain."}, nil
}

// layerViolations —— sibling imports from this file that point at the same or a higher layer.
func layerViolations(f goFile, faceted []string) []string {
	parts := strings.Split(f.dir, string(filepath.Separator))
	if len(parts) < 2 || !slices.Contains(faceted, parts[0]) {
		return nil
	}
	domain, layer := parts[0], parts[1]
	lvl, ok := layerOf[layer]
	if !ok {
		return nil // non-DDD sub-package (jobs / search / contract ...): own boundary.
	}
	var out []string
	for _, imp := range f.imports {
		if imp.domain != domain || imp.sub == layer {
			continue
		}
		if other, isLayer := layerOf[imp.sub]; isLayer && other >= lvl {
			out = append(out, fmt.Sprintf("  internal/%s/%s  ->  internal/%s/%s  "+
				"(illegal layer direction)", domain, layer, domain, imp.sub))
		}
	}
	return out
}

func checkFacade(internal string) (result, error) {
	files, err := scan(internal, false)
	if err != nil {
		return result{}, err
	}
	faceted := facetedDomains(internal)
	var bad []string
	for _, f := range files {
		owning := topDir(f.dir)
		for _, imp := range f.imports {
			if bypassesFacade(imp, owning, faceted) {
				bad = append(bad, fmt.Sprintf("  %s  -> internal/%s/%s  "+
					"(must go through .../facade)", f.rel, imp.domain, imp.sub))
			}
		}
	}
	slices.Sort(bad)
	bad = slices.Compact(bad)
	if len(bad) > 0 {
		return result{
			headline: "check-domain-facade-boundary: outside code bypasses the facade and " +
				"imports a domain's guts:",
			findings: bad,
		}, nil
	}
	return result{headline: fmt.Sprintf("check-domain-facade-boundary: %d domain(s) have a "+
		"facade; outside code reaches them only via .../facade.", len(faceted))}, nil
}

// bypassesFacade —— an outside package reaching a faceted domain's guts. A domain touching its own
// subpackages is fine (the facade lives there and imports guts), and own-boundary sub-modules are
// their own entry points.
func bypassesFacade(imp importRef, owning string, faceted []string) bool {
	if !slices.Contains(faceted, imp.domain) || imp.domain == owning {
		return false
	}
	return imp.sub != "" && imp.sub != "facade" && !submodules[imp.sub]
}
