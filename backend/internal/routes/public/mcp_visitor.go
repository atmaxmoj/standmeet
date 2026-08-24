// mcp_visitor.go —— **访客那一侧的 MCP 面**：拿着一张码的人，可以把自己的 AI 客户端
// （Claude Desktop / Cursor / …）指到这个实例上，用那张码授予的工具直接问。
//
// 为什么它该存在：owner 早就有一个 MCP 面（`/mcp`，Sigv1 验签），对外却只有两条路 ——
// 网页上的对话，和给程序用的 API key。而**「拿着码的人用自己的 AI 来问」这件事一直没有面**。
// 招聘方扫了码，他手边正开着一个 AI 客户端；今天他只能去网页上聊。
//
// 形状跟自定义页是同一条不变式：**这只是那张码的又一个渲染**。同一份授权、同一个角色、
// 同一套配额、同一份记账 —— 所以这里没有一行「MCP 专用」的准入逻辑：
// 认证换成码，装配和执行走的是访客工具那条现成的路（tools.go 的 AssembleVisitorForTool
// → InvokableRun）。任何一条 deny / 配额 / 撤销，在这一面上自动同样生效。
//
// 认证为什么收**码本身**而不是 session token：MCP 客户端的配置里只放得下一个静态字符串，
// 它做不了「先开会话再拿 token」那一步。而码正是产品发出去的那张票（二维码、简历右上角）——
// 收它，等于这一面跟其他面用的是同一张票。

package public

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"

	"github.com/atmaxmoj/standmeet/internal/capabilities/capreg"
	"github.com/atmaxmoj/standmeet/internal/infra/apierr"
)

// visitorMCPPath —— 挂载点。owner 那一面是 `/mcp`，这一面是它的对外孪生。
const visitorMCPPath = "/mcp/visitor"

// visitorNameHeader —— 可选：客户端自报名字。网页那条路有「你是谁」的弹窗，
// MCP 没有界面可弹，所以给一个头；不给就是匿名成员，跟网页上点 skip 同一种人。
const visitorNameHeader = "X-Standmeet-Visitor"

type visitorMCPKey struct{}

// visitorMCPSession —— 这一条 MCP 连接背后的那一场访客会话。
//
// 存的是**装配好的入参**而不是原始 session 行：这一面不需要知道 session 长什么样，
// 它只把它交给能力装配。少一个域类型跨进来，这一面就少一处会跟着域一起改的地方。
type visitorMCPSession struct {
	In     *capreg.AssembleInput
	ConvID string
}

// MountVisitorMCP —— 把访客 MCP 面挂上。调用方给 `/mcp/visitor`。
//
// toolNames 由装配层给（跟 api 面同一份清单，住在 paritymanifest）——
// 这一面只声明自己要一份名单，不自己去查：清单在它该在的地方，面拿它当入参。
func (h *Handlers) MountVisitorMCP(toolNames []string) http.Handler {
	srv := server.NewMCPServer("standmeet-visitor", "0.1.0",
		server.WithToolCapabilities(true),
		// 工具表**按这张码过一遍**。全部注册一次、按会话过滤，是 mcp-go 给的做法；
		// 不过滤的话 tools/list 会报出这张码根本调不动的工具 —— 那等于对着访客的 AI
		// 撒谎，它会规划一条永远走不通的路。
		server.WithToolFilter(h.filterVisitorTools),
	)
	h.registerVisitorTools(srv, toolNames)
	httpSrv := server.NewStreamableHTTPServer(srv,
		server.WithHTTPContextFunc(carryVisitorSession),
		server.WithEndpointPath(visitorMCPPath),
	)
	return h.visitorMCPAuth(httpSrv)
}

// visitorMCPAuth —— `Authorization: Bearer <code>` → 开一场会话。
//
// 每条连接开一场：配额、成员、逐字稿因此跟网页那条路记在同一个地方，
// owner 在 /admin/conversations 里看得见它是从哪张码来的。
func (h *Handlers) visitorMCPAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sess, refusal := h.openVisitorMCP(r)
		if sess == nil {
			writeVisitorMCPErr(w, refusal.Status, refusal.Message)
			return
		}
		ctx := context.WithValue(r.Context(), visitorMCPKey{}, sess)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// openVisitorMCP —— 这一条连接进不进得来。进不来时回**那句要给对面看的话**，
// 不是一个状态码：客户端那头没有界面，它能拿到的全部就是这句话。
//
// 真正开会话那一步落在 sessions.go（`OpenCodeSession`）—— 那里是这个实例**所有**
// 「拿一张码换一场会话」的去处。这一面只负责 MCP 那一半：读头、把结论塞进 ctx。
func (h *Handlers) openVisitorMCP(r *http.Request) (*visitorMCPSession, apierr.Envelope) {
	code, refusal := h.visitorMCPCredential(r)
	if code == "" {
		return nil, refusal
	}
	return h.visitorMCPSessionFor(r, code)
}

// visitorMCPCredential —— 这次请求带没带一张**现在还能用**的票。空串 = 没带或被闸挡住。
func (h *Handlers) visitorMCPCredential(r *http.Request) (string, apierr.Envelope) {
	code := bearerCode(r.Header.Get("Authorization"))
	if code == "" {
		return "", apierr.Envelope{
			Status:  http.StatusUnauthorized,
			Code:    "code_missing",
			Message: "present your access code as `Authorization: Bearer <code>`",
		}
	}
	// 猜码那道闸也要挡这一面。**一个新入口不许把已经关上的洞重新打开**：
	// 网页那条路上同一个 IP 连着试错码会被锁 15 分钟；这一面收的是同一种秘密，
	// 少了它，攻击者换个端点就能不限速地穷举（[[gate-after-early-return-is-walkable]]）。
	if h.CodeGuard.Locked(r.Context(), clientIP(r), "") {
		return "", apierr.Envelope{
			Status:  http.StatusTooManyRequests,
			Code:    "code_locked",
			Message: "too many failed codes from this address — try again later",
		}
	}
	return code, apierr.Envelope{}
}

func (h *Handlers) visitorMCPSessionFor(
	r *http.Request, code string,
) (*visitorMCPSession, apierr.Envelope) {
	opened, env := h.OpenCodeSession(
		r.Context(), code, r.Header.Get(visitorNameHeader), clientIP(r))
	if opened.In == nil {
		return nil, env
	}
	return &visitorMCPSession{In: opened.In, ConvID: opened.ConvID}, apierr.Envelope{}
}

func bearerCode(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}
	return strings.TrimSpace(header[len(prefix):])
}

// carryVisitorSession —— 把会话从 request ctx 转进 mcp ctx，让工具处理函数读得到。
func carryVisitorSession(ctx context.Context, r *http.Request) context.Context {
	s, ok := r.Context().Value(visitorMCPKey{}).(*visitorMCPSession)
	if !ok {
		return ctx
	}
	return context.WithValue(ctx, visitorMCPKey{}, s)
}

func visitorMCPFrom(ctx context.Context) *visitorMCPSession {
	s, ok := ctx.Value(visitorMCPKey{}).(*visitorMCPSession)
	if !ok {
		return nil
	}
	return s
}

// registerVisitorTools —— 注册**对外那一组**工具。跟 api 面同一份来源，
// 两个对外面报出的东西才不会各飘各的。
func (h *Handlers) registerVisitorTools(srv *server.MCPServer, names []string) {
	for _, name := range names {
		srv.AddTool(
			mcpgo.NewToolWithRawSchema(name, visitorToolDesc(name), visitorToolSchema()),
			h.runVisitorTool(name),
		)
	}
}

// visitorToolSchema —— 入参形状由能力自己定，这一层不复述一遍（复述就是第二份真源）。
// 真正的校验在工具自己那儿。
func visitorToolSchema() json.RawMessage {
	return json.RawMessage(`{"type":"object","additionalProperties":true}`)
}

func visitorToolDesc(name string) string {
	return name + " — scoped to the access code you presented."
}

// filterVisitorTools —— 只报**这张码真的调得动**的那些。
func (h *Handlers) filterVisitorTools(ctx context.Context, tools []mcpgo.Tool) []mcpgo.Tool {
	s := visitorMCPFrom(ctx)
	if s == nil {
		// 空表，不是 nil。没有会话就是「一个工具都不给你」—— 一个明确的答案，
		// 而不是一个让对面去猜的空指针。
		return []mcpgo.Tool{}
	}
	return keepNamed(tools, h.visitorGrantedNames(ctx, s))
}

// visitorGrantedNames —— 这张码这一刻真的调得动哪些工具。
func (h *Handlers) visitorGrantedNames(
	ctx context.Context, s *visitorMCPSession,
) map[string]bool {
	in := s.In
	live := make(map[string]bool)
	for _, spec := range h.Visitor.AgentSkills.AssembleVisitorBundle(ctx, in).ToolSpecs {
		live[spec.Name] = true
	}
	return live
}

func keepNamed(tools []mcpgo.Tool, live map[string]bool) []mcpgo.Tool {
	out := make([]mcpgo.Tool, 0, len(tools))
	for i := range tools {
		if live[tools[i].Name] {
			out = append(out, tools[i])
		}
	}
	return out
}

// runVisitorTool —— 执行一次调用。走的是访客工具那条**现成的**路
// （AssembleVisitorForTool → InvokableRun），所以 deny / 配额 / 撤销全部照旧生效。
func (h *Handlers) runVisitorTool(name string) server.ToolHandlerFunc {
	return func(ctx context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		s := visitorMCPFrom(ctx)
		if s == nil {
			return mcpgo.NewToolResultError("no session on this connection"), nil
		}
		in := s.In
		bindings := h.Visitor.AgentSkills.AssembleVisitorForTool(ctx, in, name)
		defer closeBindings(bindings)
		tool, found := findBindingTool(bindings, name)
		if !found {
			// 「这张码没开这个工具」跟「这个工具坏了」是两件事，说清楚哪一件。
			return mcpgo.NewToolResultError(
				"this access code does not grant " + name), nil
		}
		return runVisitorToolCall(ctx, tool, &req), nil
	}
}

// runVisitorToolCall —— 一次调用的结果。**工具自己的失败是一个「结果」，不是传输错误**：
// MCP 里把它当传输错误抛出去，对面的客户端会以为连接坏了，而实际上只是这一次调用被拒了
// （配额、准入、参数不对）。所以这里只回结果。
func runVisitorToolCall(
	ctx context.Context, tool *capreg.BindingTool, req *mcpgo.CallToolRequest,
) *mcpgo.CallToolResult {
	body, merr := json.Marshal(req.GetArguments())
	if merr != nil {
		return mcpgo.NewToolResultError("bad arguments: " + merr.Error())
	}
	out, execErr := tool.Tool.InvokableRun(ctx, string(body))
	if execErr != nil {
		return mcpgo.NewToolResultError(execErr.Error())
	}
	return mcpgo.NewToolResultText(out)
}

// writeVisitorMCPErr —— 拒绝这一次连接。
//
// 401 必须**自报认证方式**。MCP 的认证故事是 OAuth 2.1，所以一个光秃秃的 401，
// 守规矩的客户端会当成「这台服务器要 OAuth」然后跑去做发现 —— 官方 Inspector 就是这样，
// 人看到的是 `Interactive OAuth requires a TTY`，而我们写的那句「带上你的访问码」
// 一个字都没露面（F-P-8）。**body 里有那句话是不够的：没人会看到 body。**
//
// 按 RFC 6750 报 Bearer，并把那句话放进 error_description —— 客户端会把它显示出来。
func writeVisitorMCPErr(w http.ResponseWriter, status int, msg string) {
	if status == http.StatusUnauthorized {
		w.Header().Set("WWW-Authenticate", bearerChallenge(msg))
	}
	http.Error(w, msg, status)
}

// bearerChallenge —— `Bearer realm="standmeet", error_description="…"`。
// 引号里的内容要转义：那句话里出现一个双引号就会把这个头截断，
// 而截断的头比没有还糟 —— 客户端会读到半句。
func bearerChallenge(msg string) string {
	safe := strings.NewReplacer(`"`, `'`, "\\", "", "\r", " ", "\n", " ").Replace(msg)
	return `Bearer realm="standmeet", error="invalid_token", error_description="` + safe + `"`
}
