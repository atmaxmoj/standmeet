// check-routes-via-dispatcher —— 面只能从出站收口取能力。
//
// # 规则
//
// internal/routes 下**除收口以外**的文件不可以 import 任何域的 facade
// （internal/<domain>/facade）。面要用的能力，必须先在收口声明成 Op，面经 Face 取。
//
// 收口本身**当然**要 import 各域的 facade —— 它是出站汇聚点，认识每个域是它的定义。
// facade 存在的意义就是给它这条路：域的正门开着，只是不许**面**从这儿进。
//
// 这个范围我一开始写错过：扫了整个 internal/routes，把收口自己也禁了。后果是一连串的 ——
// 调用只能挪到唯一能同时看见两边的地方（组装根），于是每个资源都要在收口重新声明一遍
// 域已有的入参/出参，再写一段"把 A 抄成 B"的搬运。**内部的能力被这道门推到了外部。**
//
// # 为什么
//
// 出站收口能保证 parity、能做策略的唯一施加点，前提是**没有别的路能拿到能力**。只要一个 handler
// 还能直接 import corpus/facade 自己调，它服务的那个能力就没在收口登记过：MCP 面不知道它存在，
// Conform 也对不出它缺席 —— 收口退化成"一部分能力恰好放在那儿"，保证全部作废。
//
// 路由形状、方法、路径、参数绑定、状态码仍然照常手写。被禁的只有一件事：绕过收口直接够到域。
//
// # 棘轮
//
// 迁移前 internal/routes/admin 有 50 个文件直连域 facade。一次全改不现实，所以基线记下这些文件，
// **只能变短**：每把一个资源搬进收口，就从基线里删掉它的文件名。基线里没有的文件一旦直连 → 红。
// 基线为空时，把 baseline 清空即可，规则自动变成全域强制。
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

// scanRoot —— 只管面这一层。不读 os.Args / env（gosec G703：别把路径当 untrusted input）。
const scanRoot = "./internal/routes"

// convergences —— 两个收口自己。它们不是面，是面（或沙箱能力）取能力的那个点，所以不在
// 这条规则里。
//
//	出站  internal/routes/dispatcher —— 面从这儿取能力
//	入站  internal/routes/hostdesk   —— 沙箱里的能力从这儿回头问宿主要东西
//
// 上面那段"我一开始写错过"的教训对两边同样成立：把收口自己也禁掉，调用就只能挪到唯一能
// 同时看见两边的地方（组装根），于是那儿又长出一份手写搬运。入站那半边正是这么长出四个
// 手写网关的。
var convergences = []string{
	"internal/routes/dispatcher/",
	"internal/routes/hostdesk/",
}

// facadeSuffix —— 域对外的唯一入口就叫 facade（check-domain-facade-boundary 保证这点）。
const facadeSuffix = "/facade"

// modulePrefix —— 本仓 import path 前缀。
const modulePrefix = "github.com/atmaxmoj/standmeet/internal/"

// baseline —— 迁移前就已经直连域 facade 的文件（相对 backend/ 的路径）。
//
// **这份名单只能变短。** 每把一个资源搬进出站收口，删掉对应文件那一行。
// 不要往里加行：加行意味着又造了一条绕过收口的路。
var baseline = map[string]bool{
	"internal/routes/admin/auth.go":  true,
	"internal/routes/admin/claim.go": true,
	// corpus.go / corpus_crud.go 只剩树和分页那两个面板独有的视图还直连;列表 / 详情 /
	// 建改删提升都经收口了。corpus_detail.go 和 corpus_output.go 整个消失。
	"internal/routes/admin/corpus.go":                   true,
	"internal/routes/admin/corpus_page.go":              true,
	"internal/routes/admin/corpus_tree.go":              true,
	"internal/routes/admin/corpus_tree_subjectivity.go": true,
	"internal/routes/admin/corpus_views.go":             true,
	"internal/routes/admin/keypairs.go":                 true,
	"internal/routes/admin/obsidian.go":                 true,
	"internal/routes/admin/recovery.go":                 true,
	"internal/routes/admin/writings.go":                 true,
	"internal/routes/admin/writings_multipart.go":       true,
	"internal/routes/admin/writings_tree.go":            true,
	"internal/routes/capload/api_key_toolset.go":        true,
	"internal/routes/capload/capreg_ext_mcp.go":         true,
	"internal/routes/capload/capreg_ext_mcp_deps.go":    true,
	"internal/routes/capload/capreg_mcp_app.go":         true,
	"internal/routes/capload/capreg_register.go":        true,
	"internal/routes/capload/capreg_skill_runner.go":    true,
	"internal/routes/mcphandle/server.go":               true,
	"internal/routes/pubapi/dispatch.go":                true,
	"internal/routes/pubapi/pubapi.go":                  true,
	"internal/routes/public/access_requests.go":         true,
	"internal/routes/public/agent_turn.go":              true,
	"internal/routes/public/app_state.go":               true,
	"internal/routes/public/byoai_envelope.go":          true,
	"internal/routes/public/chat.go":                    true,
	"internal/routes/public/custom_pages.go":            true,
	"internal/routes/public/ghosts.go":                  true,
	"internal/routes/public/history.go":                 true,
	"internal/routes/public/landing.go":                 true,
	"internal/routes/public/llm_chat_stream.go":         true,
	"internal/routes/public/page.go":                    true,
	"internal/routes/public/password_reset.go":          true,
	"internal/routes/public/prompts.go":                 true,
	"internal/routes/public/report.go":                  true,
	"internal/routes/public/report_pdf.go":              true,
	"internal/routes/public/seo.go":                     true,
	"internal/routes/public/sessions.go":                true,
	"internal/routes/public/sessions_guard.go":          true,
	"internal/routes/public/tools.go":                   true,
	"internal/routes/public/visitor_conversations.go":   true,
	"internal/routes/public/wiki_tree.go":               true,
	"internal/routes/public/writing_tree.go":            true,
	"internal/routes/public/writings.go":                true,
	"internal/routes/sys/builds.go":                     true,
	"internal/routes/sys/diag_session.go":               true,
	"internal/routes/sys/tls_ask.go":                    true,
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

// offenders —— scanRoot 下所有 import 了某个域 facade 的文件。
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

// skipPath —— 目录、非 Go 文件、测试文件不看;两个收口自己也不看(它们不是面)。
func skipPath(path string, isDir bool) bool {
	if isDir || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
		return true
	}
	return atConvergence(filepath.ToSlash(path))
}

// atConvergence —— 这个文件是不是某个收口自己的。
func atConvergence(path string) bool {
	for _, c := range convergences {
		if strings.Contains(path, c) {
			return true
		}
	}
	return false
}

// isDomainFacade —— internal/<domain>/facade（正好两段，排除 internal/routes/... 这种更深的）。
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
