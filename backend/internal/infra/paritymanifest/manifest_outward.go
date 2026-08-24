package paritymanifest

// manifest_outward.go —— the OUTWARD-plane manifest (facade-directions.md). These are the
// role-grantable capabilities served to granted outsiders: the chat facade (LLM in the loop) and
// the api facade (programmatic, no LLM). Owner-plane ops live in manifest_table*.go; the two planes
// never mix (an op on the wrong-plane facade is a "leak" — enforced by facadeparity.Conform).
//
// The api facade renders one endpoint per op, named by the op-id, so no primitive→op mapping is
// needed here (unlike the owner side, where one admin route can serve several MCP tools). The
// chat facade's realizing tool names (corpus_search / calendar_book / …) are wired to these ops in
// Wave D when the live registry ratchet lands; this file is the semantic source of truth.

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// Outward facade names.
const (
	FacadeChat = "chat"
	FacadeAPI  = "api"
	// FacadeMCPVisitor —— 访客把**自己的** AI 客户端指过来的那一面（`/mcp/visitor`，
	// 认一张码）。跟 api 同属对外平面、同样是程序面（LLM 在对面，不在我们这儿），
	// 所以它渲染的是同一组非 Agentic 的对外能力。
	//
	// 它在这里登记，是因为「以后加一个面也从这边出」只有登记了才成立：
	// 上一版这一面是**建完就挂上去**的，没有任何东西保证它跟别的对外面报出同一套东西，
	// 也没有任何东西拦住有人往它上面挂一个 owner 能力。
	FacadeMCPVisitor = "mcp-visitor"
)

// Outward op-ids. The non-Agentic ones are api candidates (they enter KnownAPIGaps until the api
// renderer serves them); the Agentic ones (ask / summarize / mail) only ever render on chat.
const (
	OpCorpusSearch = "outward.corpus.search"
	OpCorpusRead   = "outward.corpus.read"
	OpCorpusList   = "outward.corpus.list"
	OpCorpusLinks  = "outward.corpus.links"
	OpBookingSlots = "outward.booking.slots"
	OpBookingBook  = "outward.booking.book"
	OpAsk          = "outward.ask"
	OpSummarize    = "outward.summarize"
	OpMailSend     = "outward.mail.send"
)

// query —— a read-derived-from-query op (HTTP QUERY, RFC 10008); see facadeparity.Kind.
func query(id string, r fp.Reach) fp.Op { return fp.Op{ID: id, Kind: fp.Query, Reach: r} }

// ManifestOutward —— the outward-plane ops. Reads/queries are grantable to any outward facade;
// Agentic actions Except the api facade (it can't carry an LLM-in-the-loop op).
func ManifestOutward() []fp.Op {
	return []fp.Op{
		query(OpCorpusSearch, fp.OutwardRead()),
		read(OpCorpusRead, fp.OutwardRead()),
		read(OpCorpusList, fp.OutwardRead()),
		read(OpCorpusLinks, fp.OutwardRead()),
		read(OpBookingSlots, fp.OutwardRead()),
		act(OpBookingBook, fp.OutwardAction()),
		act(OpAsk, fp.OutwardAction().Except(fp.Agentic)),
		act(OpSummarize, fp.OutwardAction().Except(fp.Agentic)),
		act(OpMailSend, fp.OutwardAction().Except(fp.Agentic)),
	}
}

// apiFacade —— the api facade profile: outward plane, programmatic (no Agentic), serves reads +
// actions. (The chat facade profile — which carries Agentic — is wired with the live chat ratchet
// in Wave D; FacadeChat above reserves its name.)
func apiFacade() fp.Facade {
	return fp.Facade{Name: FacadeAPI, Plane: fp.PlaneOutward, ServesRead: true, ServesActn: true}
}

// mcpVisitorFacade —— 访客 MCP 面的画像。跟 api 同一档：对外平面、程序面（不载 Agentic）、
// 读和动作都服务。**同一档就该报同一套东西** —— 两个对外面各报各的，正是这条轴要防的事。
func mcpVisitorFacade() fp.Facade {
	return fp.Facade{
		Name: FacadeMCPVisitor, Plane: fp.PlaneOutward, ServesRead: true, ServesActn: true,
	}
}

// MCPVisitorMissing —— 按 Reach 本该出现在访客 MCP 面、却没有被任何一个活工具实现的 op。
// 跟 APIMissing 同一个形状、同一个棘轮：从渲染器里掉一个工具，它就重新长出来 → 红。
func MCPVisitorMissing(liveTools []string) []string {
	exposure := fp.Exposure{Facade: mcpVisitorFacade(), Exposed: exposedAPIOps(liveTools)}
	return missingOnFacade(fp.Conform(ManifestOutward(), []fp.Exposure{exposure}),
		FacadeMCPVisitor)
}

// outwardTool —— the visitor-facing tool name that realizes an outward op on the chat/api facades.
type outwardTool struct {
	Op   string
	Tool string
}

// apiRenderable —— the non-Agentic outward ops the api facade renders, each as its live visitor
// tool. This is the single source the pubapi renderer whitelists AND the ratchet checks, so a tool
// dropped from the renderer re-grows APIMissing → RED.
func apiRenderable() []outwardTool {
	return []outwardTool{
		{Op: OpCorpusSearch, Tool: "corpus_search"},
		{Op: OpCorpusRead, Tool: "corpus_read"},
		{Op: OpCorpusList, Tool: "corpus_list"},
		{Op: OpCorpusLinks, Tool: "corpus_links"},
		{Op: OpBookingSlots, Tool: "calendar_list_slots"},
		{Op: OpBookingBook, Tool: "calendar_book"},
	}
}

// APIRenderableTools —— the tool names the api facade serves (one per non-Agentic outward op). The
// pubapi renderer uses this as its whitelist; passing it to APIMissing yields the empty paydown.
func APIRenderableTools() []string {
	r := apiRenderable()
	out := make([]string, len(r))
	for i := range r {
		out[i] = r[i].Tool
	}
	return out
}

// APICandidateCapabilities —— the capreg capability ids an owner may OPEN to the api facade: the
// non-Agentic outward capabilities whose tools are api-renderable. Opening anything else (an
// owner-only cap, or an Agentic one like mail.send) is rejected by api.open. This is the capability
// grain of the tool-grain apiRenderable() list.
func APICandidateCapabilities() []string {
	return []string{"corpus.retrieval", "calendar.book"}
}

// OutwardOpForTool —— map a rendered api tool name back to its outward op-id (for the ratchet).
func OutwardOpForTool(tool string) (string, bool) {
	for _, t := range apiRenderable() {
		if t.Tool == tool {
			return t.Op, true
		}
	}
	return "", false
}

// APIMissing —— op-ids that per their Reach must be on the api facade but aren't realized by any
// live api tool. The api paydown worklist: an empty renderer → every non-Agentic outward op is
// missing; whitelisting a tool shrinks it. Mirrors MCPMissing.
func APIMissing(liveAPITools []string) []string {
	exposure := fp.Exposure{Facade: apiFacade(), Exposed: exposedAPIOps(liveAPITools)}
	return missingAPIOps(fp.Conform(ManifestOutward(), []fp.Exposure{exposure}))
}

func exposedAPIOps(liveAPITools []string) map[string]bool {
	out := make(map[string]bool, len(liveAPITools))
	for _, t := range liveAPITools {
		if op, ok := OutwardOpForTool(t); ok {
			out[op] = true
		}
	}
	return out
}

func missingAPIOps(vs []fp.Violation) []string {
	return missingOnFacade(vs, FacadeAPI)
}

// missingOnFacade —— 某一个面上「本该有却没有」的那些 op。两个对外面共用一份提取，
// 是因为它们问的是同一个问题；各写一份的话，加第三个面时又会各飘各的。
func missingOnFacade(vs []fp.Violation, facade string) []string {
	out := []string{}
	for _, v := range vs {
		if v.Facade == facade && v.Kind == "missing" {
			out = append(out, v.OpID)
		}
	}
	return out
}

// AllOps —— the combined owner + outward op set. The one manifest a full boot/leak check runs over:
// any facade (owner or outward) exposing an op of the other plane surfaces as a leak.
func AllOps() []fp.Op {
	m := Manifest()
	outward := ManifestOutward()
	out := make([]fp.Op, 0, len(m)+len(outward))
	for i := range m {
		out = append(out, m[i].Op)
	}
	return append(out, outward...)
}
