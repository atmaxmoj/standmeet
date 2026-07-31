// check-routes-via-dispatcher —— 面只能从出站收口取能力。
//
// # 规则
//
// internal/routes/** 下的文件不可以 import 任何域的 facade（internal/<domain>/facade）。
// 面要用的能力，必须由组装根声明成 dispatcher 的 Op，面经 Face 取。
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

// facadeSuffix —— 域对外的唯一入口就叫 facade（check-domain-facade-boundary 保证这点）。
const facadeSuffix = "/facade"

// modulePrefix —— 本仓 import path 前缀。
const modulePrefix = "github.com/atmaxmoj/standmeet/internal/"

// baseline —— 迁移前就已经直连域 facade 的文件（相对 backend/ 的路径）。
//
// **这份名单只能变短。** 每把一个资源搬进出站收口，删掉对应文件那一行。
// 不要往里加行：加行意味着又造了一条绕过收口的路。
var baseline = map[string]bool{
	"internal/routes/admin/access_requests.go":               true,
	"internal/routes/admin/account.go":                       true,
	"internal/routes/admin/ai_provider.go":                   true,
	"internal/routes/admin/appearance.go":                    true,
	"internal/routes/admin/auth.go":                          true,
	"internal/routes/admin/booking_policy.go":                true,
	"internal/routes/admin/booking_store_deps.go":            true,
	"internal/routes/admin/bookings.go":                      true,
	"internal/routes/admin/byoai.go":                         true,
	"internal/routes/admin/capabilities.go":                  true,
	"internal/routes/admin/claim.go":                         true,
	"internal/routes/admin/codes.go":                         true,
	"internal/routes/admin/codes_view.go":                    true,
	"internal/routes/admin/codes_waypoints.go":               true,
	"internal/routes/admin/conversations.go":                 true,
	"internal/routes/admin/conversations_ghost_telemetry.go": true,
	"internal/routes/admin/corpus.go":                        true,
	"internal/routes/admin/corpus_crud.go":                   true,
	"internal/routes/admin/corpus_detail.go":                 true,
	"internal/routes/admin/corpus_output.go":                 true,
	"internal/routes/admin/corpus_page.go":                   true,
	"internal/routes/admin/corpus_tree.go":                   true,
	"internal/routes/admin/corpus_tree_subjectivity.go":      true,
	"internal/routes/admin/corpus_views.go":                  true,
	"internal/routes/admin/custom_pages.go":                  true,
	"internal/routes/admin/domains.go":                       true,
	"internal/routes/admin/handle.go":                        true,
	"internal/routes/admin/inference_usage.go":               true,
	"internal/routes/admin/keypairs.go":                      true,
	"internal/routes/admin/marketplace.go":                   true,
	"internal/routes/admin/mcp_servers.go":                   true,
	"internal/routes/admin/me.go":                            true,
	"internal/routes/admin/obsidian.go":                      true,
	"internal/routes/admin/page.go":                          true,
	"internal/routes/admin/prompts.go":                       true,
	"internal/routes/admin/public_url.go":                    true,
	"internal/routes/admin/recovery.go":                      true,
	"internal/routes/admin/roles.go":                         true,
	"internal/routes/admin/seo.go":                           true,
	"internal/routes/admin/skills.go":                        true,
	"internal/routes/admin/stats_activity.go":                true,
	"internal/routes/admin/stats_growth.go":                  true,
	"internal/routes/admin/stats_jobs.go":                    true,
	"internal/routes/admin/system.go":                        true,
	"internal/routes/admin/writings.go":                      true,
	"internal/routes/admin/writings_multipart.go":            true,
	"internal/routes/admin/writings_tree.go":                 true,
	"internal/routes/capload/api_key_toolset.go":             true,
	"internal/routes/capload/capreg_ext_mcp.go":              true,
	"internal/routes/capload/capreg_ext_mcp_deps.go":         true,
	"internal/routes/capload/capreg_mcp_app.go":              true,
	"internal/routes/capload/capreg_register.go":             true,
	"internal/routes/capload/capreg_skill_runner.go":         true,
	"internal/routes/conversation/socket.go":                 true,
	"internal/routes/mcphandle/server.go":                    true,
	"internal/routes/owner/socket.go":                        true,
	"internal/routes/pubapi/dispatch.go":                     true,
	"internal/routes/pubapi/pubapi.go":                       true,
	"internal/routes/public/access_requests.go":              true,
	"internal/routes/public/agent_turn.go":                   true,
	"internal/routes/public/app_state.go":                    true,
	"internal/routes/public/booking_cancellation.go":         true,
	"internal/routes/public/byoai_envelope.go":               true,
	"internal/routes/public/chat.go":                         true,
	"internal/routes/public/custom_pages.go":                 true,
	"internal/routes/public/ghosts.go":                       true,
	"internal/routes/public/history.go":                      true,
	"internal/routes/public/landing.go":                      true,
	"internal/routes/public/llm_chat_stream.go":              true,
	"internal/routes/public/page.go":                         true,
	"internal/routes/public/password_reset.go":               true,
	"internal/routes/public/prompts.go":                      true,
	"internal/routes/public/report.go":                       true,
	"internal/routes/public/report_pdf.go":                   true,
	"internal/routes/public/seo.go":                          true,
	"internal/routes/public/sessions.go":                     true,
	"internal/routes/public/sessions_guard.go":               true,
	"internal/routes/public/tools.go":                        true,
	"internal/routes/public/visitor_conversations.go":        true,
	"internal/routes/public/wiki_tree.go":                    true,
	"internal/routes/public/writing_tree.go":                 true,
	"internal/routes/public/writings.go":                     true,
	"internal/routes/report/socket.go":                       true,
	"internal/routes/sys/builds.go":                          true,
	"internal/routes/sys/diag_session.go":                    true,
	"internal/routes/sys/tls_ask.go":                         true,
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
		if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
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
