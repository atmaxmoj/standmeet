// check-routes-via-dispatcher —— faces may only get capability through the
// outbound convergence point.
//
// # Rule
//
// A file under internal/routes **other than the convergence point itself** may
// not import any domain's facade (internal/<domain>/facade). Any capability a
// face needs must first be declared as an Op on the convergence point, and the
// face gets it through Face.
//
// The convergence point itself **naturally** has to import each domain's facade
// — it is the outbound aggregation point, and knowing every domain is exactly its
// job. The facade exists precisely to give it that path: the domain's front door
// stays open, it's just that a **face** may not come in through it.
//
// I got this scope wrong once, early on: scanned the whole internal/routes and
// banned the convergence point itself too. The consequence was a chain reaction —
// calls could only move to the one place that could see both sides (the assembly
// root), so every resource ended up re-declaring the domain's existing
// input/output params on the convergence point, plus a block of "copy A into B"
// plumbing. **Capability that belonged inside got pushed outside by this very gate.**
//
// # Why
//
// The outbound convergence point can guarantee parity and be the single place
// policy applies, only if **no other path can reach the capability**. The moment
// one handler can still import corpus/facade and call it directly, the capability
// it serves was never registered at the convergence point: the MCP face doesn't
// know it exists, Conform can't check its absence either — the convergence point
// degrades into "some capability just happens to live there", and the guarantee
// falls apart entirely.
//
// Route shape, method, path, param binding, and status codes are still written by
// hand as usual. The only thing banned is bypassing the convergence point to reach
// a domain directly.
//
// # Ratchet
//
// Before migration, internal/routes/admin had 50 files connecting directly to a
// domain facade. Changing them all at once wasn't realistic, so the baseline
// records these files, and it **can only shrink**: every time a resource is moved
// onto the convergence point, its filename comes out of the baseline. Any file not
// in the baseline that connects directly -> red. Once the baseline is empty,
// clearing it turns the rule into a domain-wide requirement automatically.
package main

import (
	"fmt"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// scanRoot —— covers only the face layer. Doesn't read os.Args / env (gosec G703:
// don't treat a path as untrusted input).
const scanRoot = "./internal/routes"

// convergences —— the two convergence points themselves. They are not faces, they
// are the points where a face (or a sandboxed capability) gets capability from, so
// they are not covered by this rule.
//
//	outbound  internal/routes/dispatcher —— faces get capability from here
//	inbound   internal/routes/hostdesk   —— capabilities inside the sandbox come
//	                                         back here to ask the host for things
//
// The lesson from "I got this wrong once, early on" above applies equally to both
// sides: ban the convergence point itself too, and calls can only move to the one
// place that sees both sides (the assembly root), growing another block of
// hand-written plumbing there. That is exactly how the inbound half ended up with
// four hand-written gateways.
var convergences = []string{
	"internal/routes/dispatcher/",
	"internal/routes/hostdesk/",
}

// facadeSuffix —— a domain's one and only external entry point is called facade
// (check-domain-facade-boundary guarantees this).
const facadeSuffix = "/facade"

// modulePrefix —— this repo's import path prefix.
const modulePrefix = "github.com/atmaxmoj/standmeet/internal/"

// baseline —— files that already connected directly to a domain facade before the
// migration (paths relative to backend/).
//
// **This list may only shrink.** Every time a resource moves onto the outbound
// convergence point, delete that file's line. Don't add lines: adding one means
// another path around the convergence point was just created.
var baseline = map[string]bool{
	"internal/routes/admin/auth.go":  true,
	"internal/routes/admin/claim.go": true,
	// corpus.go / corpus_crud.go: only the tree and pagination views, unique to the
	// panel, still connect directly; list / detail / create / edit / delete / promote
	// all go through the convergence point now. corpus_detail.go and corpus_output.go
	// disappeared entirely.
	"internal/routes/admin/corpus.go":                   true,
	"internal/routes/admin/corpus_page.go":              true,
	"internal/routes/admin/corpus_tree.go":              true,
	"internal/routes/admin/corpus_tree_subjectivity.go": true,
	"internal/routes/admin/corpus_views.go":             true,
	"internal/routes/admin/keypairs.go":                 true,
	"internal/routes/admin/obsidian.go":                 true,
	"internal/routes/admin/recovery.go":                 true,
	// writings.go / writings_multipart.go finished migrating — now that the
	// convergence point has a channel for carrying bytes, the save path goes through
	// Face.OpFiles, the same op as the MCP path. The remaining writings_tree.go: tree
	// and pagination are views unique to the panel (a lazy-load layer / a keyset page),
	// and don't have a matching op yet.
	"internal/routes/admin/writings_tree.go":         true,
	"internal/routes/capload/api_key_toolset.go":     true,
	"internal/routes/capload/capreg_ext_mcp.go":      true,
	"internal/routes/capload/capreg_ext_mcp_deps.go": true,
	"internal/routes/capload/capreg_mcp_app.go":      true,
	"internal/routes/capload/capreg_register.go":     true,
	"internal/routes/capload/capreg_skill_runner.go": true,
	"internal/routes/mcphandle/server.go":            true,
	"internal/routes/pubapi/dispatch.go":             true,
	"internal/routes/pubapi/pubapi.go":               true,
	"internal/routes/public/access_requests.go":      true,
	"internal/routes/public/agent_turn.go":           true,
	// agent_turn_preflight.go is the three admission gates (privilege escalation /
	// budget / turn count) split out of agent_turn.go — the same old debt under a new
	// filename, not newly incurred.
	"internal/routes/public/agent_turn_preflight.go":  true,
	"internal/routes/public/app_state.go":             true,
	"internal/routes/public/chat.go":                  true,
	"internal/routes/public/custom_pages.go":          true,
	"internal/routes/public/ghosts.go":                true,
	"internal/routes/public/history.go":               true,
	"internal/routes/public/landing.go":               true,
	"internal/routes/public/page.go":                  true,
	"internal/routes/public/password_reset.go":        true,
	"internal/routes/public/prompts.go":               true,
	"internal/routes/public/report.go":                true,
	"internal/routes/public/report_pdf.go":            true,
	"internal/routes/public/seo.go":                   true,
	"internal/routes/public/sessions.go":              true,
	"internal/routes/public/sessions_guard.go":        true,
	"internal/routes/public/tools.go":                 true,
	"internal/routes/public/visitor_conversations.go": true,
	"internal/routes/public/wiki_tree.go":             true,
	"internal/routes/public/writing_tree.go":          true,
	"internal/routes/public/writings.go":              true,
	"internal/routes/sys/builds.go":                   true,
	"internal/routes/sys/diag_session.go":             true,
	"internal/routes/sys/tls_ask.go":                  true,
}

func main() {
	files, err := offenders()
	if err != nil {
		fmt.Fprintln(os.Stderr, "check-routes-via-dispatcher:", err)
		os.Exit(2)
	}

	fresh := []string{}
	for _, f := range files {
		if !baseline[f] {
			fresh = append(fresh, f)
		}
	}
	sort.Strings(fresh)

	if len(fresh) > 0 {
		fmt.Println("check-routes-via-dispatcher: 面直接够到了域，绕过了出站收口。")
		fmt.Println("能力要声明成 dispatcher 的 Op，面经 Face 取（路由形状照常手写）：")
		fmt.Println()
		for _, f := range fresh {
			fmt.Println("  " + f)
		}
		os.Exit(1)
	}

	stale := 0
	for f := range baseline {
		if !contains(files, f) {
			stale++
		}
	}
	fmt.Printf("check-routes-via-dispatcher: faces reach capability only through the "+
		"dispatcher (%d baselined files left to migrate", len(baseline)-stale)
	if stale > 0 {
		fmt.Printf(", %d already clean — delete them from the baseline", stale)
	}
	fmt.Println(", ratchet holds).")
}

// offenders —— every file under scanRoot that imports some domain's facade.
func offenders() ([]string, error) {
	out := []string{}
	fset := token.NewFileSet()
	err := filepath.WalkDir(scanRoot, func(path string, d fs.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		if skipPath(path, d.IsDir()) {
			return nil
		}
		f, perr := parser.ParseFile(fset, path, nil, parser.ImportsOnly)
		if perr != nil {
			return fmt.Errorf("parse %s: %w", path, perr)
		}
		for _, imp := range f.Imports {
			if isDomainFacade(strings.Trim(imp.Path.Value, `"`)) {
				out = append(out, filepath.ToSlash(path))
				return nil
			}
		}
		return nil
	})
	return out, err
}

// skipPath —— skips directories, non-Go files, test files; also skips the two
// convergence points themselves (they are not faces).
func skipPath(path string, isDir bool) bool {
	if isDir || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
		return true
	}
	return atConvergence(filepath.ToSlash(path))
}

// atConvergence —— whether this file belongs to one of the convergence points itself.
func atConvergence(path string) bool {
	for _, c := range convergences {
		if strings.Contains(path, c) {
			return true
		}
	}
	return false
}

// isDomainFacade —— internal/<domain>/facade (exactly two segments, excluding
// deeper paths like internal/routes/...).
func isDomainFacade(path string) bool {
	if !strings.HasPrefix(path, modulePrefix) || !strings.HasSuffix(path, facadeSuffix) {
		return false
	}
	rest := strings.TrimPrefix(path, modulePrefix)
	return strings.Count(rest, "/") == 1
}

func contains(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}
