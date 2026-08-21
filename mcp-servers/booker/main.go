// Command booker —— the externalized calendar.book capability as a sandboxed
// stdio MCP server (origin=builtin). It owns NO data: it reads the trusted
// session context off each tool-call `_meta` (planted by the host) and forwards
// the call to the host's narrow "book" / "list_slots" ops over a bind-mounted
// unix socket (STANDMEET_HOST_SOCKET), staying fully network-isolated. The host runs the
// real booking pipeline (policy → freebusy → insert → persist → owner notify);
// this plugin is just the agent-facing tools + their schemas.
//
// Per-visitor identity (which owner's calendar, which code's quota, the visitor's
// name/email, the role) rides the MCP-native `_meta` sidechannel — protocol data
// the host attaches, never the LLM-controlled `arguments` (so a prompt-injected
// owner/code is impossible). The result wire ({ok,...}) is unchanged from the old
// in-process capability, so the frontend cards render identically.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"

	// time/tzdata embeds the IANA timezone database in the binary. This capability evaluates
	// booking policy against the owner's named zone (e.g. America/Toronto), and it runs as a
	// static CGO_ENABLED=0 binary inside a bubblewrap sandbox with no /usr/share/zoneinfo — so
	// without this, LoadLocation fails, every candidate slot is rejected, and list_slots returns
	// an empty list that looks exactly like "the owner has no availability". The host binary
	// embeds it for the same reason; when the policy evaluator moved here, this had to move too.
	_ "time/tzdata"

	mcpgo "github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// socketEnv —— 宿主把这个能力那一根 host socket 的路径放在这里。
//
// 名字对所有能力都一样。以前每个插件自己起一个(BOOKER_SOCKET / RETRIEVAL_SOCKET / ...),
// 于是同一件事有四个名字,而且路径要在宿主的 manifest 里手写一遍。现在路径由 id 派生、
// 由装载器注入,声明里不出现路径,也不出现这个变量名。
const socketEnv = "STANDMEET_HOST_SOCKET"

func main() {
	srv := server.NewMCPServer("booker", "1.0.0",
		server.WithToolCapabilities(true),
		server.WithResourceCapabilities(false, false),
		server.WithInstructions(instructions))
	srv.AddTool(bookTool(), localHandler(doBook))
	srv.AddTool(listSlotsTool(), localHandler(doListSlots))
	srv.AddTool(sendConfirmationTool(), localHandler(doSendConfirmation))
	srv.AddTool(cancelTool(), localHandler(doCancel))
	srv.AddTool(rescheduleTool(), localHandler(doReschedule))
	srv.AddTool(cancelByIDTool(), localHandler(doCancelByID))
	srv.AddTool(listBookingsTool(), localHandler(doListBookings))
	srv.AddResource(slotsCardResource(), slotsCardHandler)
	srv.AddResource(bookedCardResource(), bookedCardHandler)
	if err := server.ServeStdio(srv); err != nil {
		fmt.Fprintln(os.Stderr, "booker:", err)
		os.Exit(1)
	}
}

// progressLabel —— set the throbber label the host surfaces while the tool runs.
func progressLabel(t mcpgo.Tool, label string) mcpgo.Tool {
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{"progress_label": label})
	return t
}

// bookTool —— 这把工具的说明书**整个写在它自己身上**，不放进 `instructions`（F-B-10）。
// 订会要写权限；owner 只授了只读时，装配期会把这把工具摘掉，说明书跟着一起走。
// 同一段话若寄放在能力级的 `instructions` 里就会留下来，继续告诉模型「你能订会」——
// 那正是产品在只读授权下答应「给我个主题我马上给你订」的来路：手上没有工具，嘴上照旧承诺。
func bookTool() mcpgo.Tool {
	return withCard(mcpgo.NewToolWithRawSchema("calendar_book",
		"Create the meeting on the owner's Google Calendar. Only call after you have "+
			"gathered topic, duration (15-180 minutes), and one or more "+
			"visitor-confirmed preferred start times in RFC3339 format. The invite "+
			"goes to the email the visitor gave when they entered (if any) — you do "+
			"not supply a recipient; the result tells you what happened. Read "+
			"`invited_email` on the result and say exactly that: if it holds an address, "+
			"the invite went there; if it is empty, nobody was invited — say so plainly "+
			"(\"no invite could be emailed, so keep a note of the time yourself\") and "+
			"offer the confirmation-email widget on the card. Never name an address the "+
			"result did not give you, even one the visitor typed earlier in the "+
			"conversation — an address in the transcript is not a recipient the booking "+
			"used. Usual flow: gather topic, duration and roughly when they want to meet, "+
			"list the free slots, let the visitor pick one, then call this with that single "+
			"confirmed time.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"topic":{"type":"string"},
				"duration_min":{"type":"integer","minimum":15,"maximum":180},
				"preferred_times":{
					"type":"array",
					"items":{"type":"string","description":"RFC3339"},
					"minItems":1
				}
			},
			"required":["topic","duration_min","preferred_times"]
		}`)), "booking meeting", bookedCardURI)
}

// sendConfirmationTool —— send the booking confirmation email for the meeting
// just booked in this conversation. Triggered by the booked card's email widget
// (mcp-ui:tool); recipient defaults to the visitor's session email unless they
// typed a different one (backend hard-controls it, D-4). Not for direct agent use.
func sendConfirmationTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("send_confirmation",
		"Send the booking confirmation email for the meeting just booked in this "+
			"conversation. This is triggered by the booking card's email widget — the "+
			"recipient is the visitor's session email unless they typed a different one. "+
			"You do not normally call this directly; the card drives it.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"recipient":{"type":"string",
					"description":"Override recipient address; empty uses the visitor's session email."},
				"tz":{"type":"string","description":"Visitor IANA timezone for rendering body times."}
			}
		}`)), "sending confirmation")
}

// cancelTool —— cancel the meeting booked in this conversation. Triggered by the
// booked card's cancel button (mcp-ui:tool). Isolation is host-side (the trusted
// conversation context), so a visitor can only cancel their own booking. Not for
// direct agent use.
func cancelTool() mcpgo.Tool {
	return progressLabel(mcpgo.NewToolWithRawSchema("calendar_cancel",
		"Cancel the meeting just booked in this conversation. This is triggered by "+
			"the booking card's cancel button — it removes the calendar event for the "+
			"booking the visitor made here. You do not normally call this directly.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"event_id":{"type":"string","description":"The booking's google_event_id from the card."}
			}
		}`)), "cancelling booking")
}

// rescheduleTool —— move the meeting booked in this conversation to a new time. Isolation is
// host-side (trusted conversation context): a visitor can only reschedule their own booking, and
// only into an owner-available slot (the host re-runs booking policy + freebusy). Atomic on the
// host: the new slot is booked first — if it's unavailable the original booking is left untouched.
func rescheduleTool() mcpgo.Tool {
	return withCard(mcpgo.NewToolWithRawSchema("calendar_reschedule",
		"Move the meeting booked in this conversation to a new time. Provide the booking's "+
			"event_id (from the card) plus the duration and one or more visitor-confirmed new "+
			"preferred start times (RFC3339). The new slot must be free and pass the owner's "+
			"booking policy; if not, the original booking stays and you get the conflict back.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"event_id":{"type":"string","description":"The booking's google_event_id from the card."},
				"duration_min":{"type":"integer","minimum":15,"maximum":180},
				"preferred_times":{
					"type":"array",
					"items":{"type":"string","description":"RFC3339"},
					"minItems":1
				}
			},
			"required":["event_id","duration_min","preferred_times"]
		}`)), "rescheduling meeting", bookedCardURI)
}

func slotsCardResource() mcpgo.Resource {
	return mcpgo.NewResource(slotsCardURI, "slots card",
		mcpgo.WithMIMEType(slotsCardMIME),
		mcpgo.WithResourceDescription("Sandboxed calendar_list_slots day picker."))
}

func slotsCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: slotsCardURI, MIMEType: slotsCardMIME, Text: slotsCardHTML},
	}, nil
}

func bookedCardResource() mcpgo.Resource {
	return mcpgo.NewResource(bookedCardURI, "booked card",
		mcpgo.WithMIMEType(bookedCardMIME),
		mcpgo.WithResourceDescription("Sandboxed calendar_book confirmation (cancel / send-confirmation)."))
}

func bookedCardHandler(
	_ context.Context, _ mcpgo.ReadResourceRequest,
) ([]mcpgo.ResourceContents, error) {
	return []mcpgo.ResourceContents{
		mcpgo.TextResourceContents{URI: bookedCardURI, MIMEType: bookedCardMIME, Text: bookedCardHTML},
	}, nil
}

// withCard —— like progressLabel but also declares the tool's ui:// card on `_meta`.
func withCard(t mcpgo.Tool, label, cardURI string) mcpgo.Tool {
	t.Meta = mcpgo.NewMetaFromMap(map[string]any{
		"progress_label": label,
		"ui_resource":    cardURI,
	})
	return t
}

// readOnly —— 声明这把工具是**安全且幂等的读**(MCP `annotations.readOnlyHint`)。
//
// 宿主拿它决定这把工具能不能走 HTTP `QUERY`(带 body 的读)。不声明 = 默认「会改东西」,
// 于是列时段这种纯读只能用 POST —— 「这次调用会不会改变什么」这个问题产品自己答错了
// (F-B-13)。四个 `corpus_*` 一直答得对,booker 的读从没答过。
func readOnly(t mcpgo.Tool) mcpgo.Tool {
	yes := true
	t.Annotations.ReadOnlyHint = &yes
	return t
}

// listBookingsTool —— owner 面:列已约的会。host 侧曾经有一条 admin REST 路由直接查
// booker 的存储(它认识了 booker 的数据形状),因为沙箱当时拿不到自己记录的 id。
func listBookingsTool() mcpgo.Tool {
	// 也是读 —— 邻居一起扫,别只修被看见的那一个([[lesson-not-swept-to-neighbours]])。
	return readOnly(mcpgo.NewToolWithRawSchema("bookings_list",
		"List the owner's confirmed bookings, newest first, each with its booking id.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"limit":{"type":"integer","description":"Max rows (default 50, max 200)."}
			}
		}`)))
}

// cancelByIDTool —— owner 面:按预约 id 取消。host 侧曾经把这套逻辑又写了一遍
// (uc_booking_cancel*.go + ownercore 的 cap_calendar),因为沙箱够不到自己记录的 id。
func cancelByIDTool() mcpgo.Tool {
	return mcpgo.NewToolWithRawSchema("calendar_cancel_booking",
		"Cancel one of the owner's bookings by its booking id: removes the calendar "+
			"event and the stored booking record.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"booking_id":{"type":"string","description":"The booking record id."}
			},
			"required":["booking_id"]
		}`))
}

func listSlotsTool() mcpgo.Tool {
	return readOnly(withCard(mcpgo.NewToolWithRawSchema("calendar_list_slots",
		"List available [start, end] slots on the owner's calendar between "+
			"from_rfc3339 and until_rfc3339 that pass booking policy and don't "+
			"overlap any busy window. Returns up to 50 slots. Use this before "+
			"calendar_book so the visitor can pick an actual free time. "+
			// UX-93：这个结果**会自己渲成一张可点的时段卡**摆在访客眼前(日期药丸 + 时段
			// chip，点一下就下单)。所以答案里不要把时段再列一遍 —— 卡是全的、答案里那份
			// 往往只列前几个，两份表示两种截断，读的人得自己判断哪份是真的。
			// 提一个具体时间是可以的(「你要的 3:00 那格不空」是在回答问题)，成串复述不行。
			"The result renders for the visitor as a slot picker, so do NOT "+
			"re-list the times in your reply — the card already shows them, and a second "+
			"partial list contradicts it. Say what the picker is and let them pick; "+
			"naming one specific time is fine when answering about that time. "+
			// F-B-10：只授只读的实例读得到空闲、写不进事件。那时卡上的 chip 不可点，
			// 而模型如果照旧说「点一下就订好了」，访客点了什么也不会发生。
			// 事实在结果里，读法写在这儿 —— 让它自己去读，别让它猜。
			"Read `can_book` on the result: it says whether a time picked here can actually "+
			"be booked. When it is false the picker is read-only — it shows when the owner "+
			"is free and nothing more. Then do not offer to book, do not tell the visitor to "+
			"tap a slot, and do not say it will be confirmed; say plainly that booking is not "+
			"available here and give them the times.",
		json.RawMessage(`{
			"type":"object",
			"properties":{
				"from_rfc3339":{"type":"string","description":"Search window start (RFC3339)."},
				"until_rfc3339":{"type":"string","description":"Search window end (RFC3339)."},
				"duration_min":{"type":"integer","minimum":15,"maximum":180,
					"description":"Slot length in minutes."},
				"step_min":{"type":"integer","minimum":15,"maximum":120,
					"description":"Enumeration step in minutes (default 30)."}
			},
			"required":["from_rfc3339","until_rfc3339","duration_min"]
		}`)), "listing slots", slotsCardURI))
}

// session —— the trusted context the host plants on the tool-call `_meta`. 只带通用身份
// (owner/code/conversation/role/visitor);booking 专属配置(quota / policy / notify)都在
// booker 自己的 capstore,按这些 id 读 —— 核心 session 一个 booking 字段都不带。
type session struct {
	OwnerID string
	// SubjectID / SubjectKind —— 这一场以谁的身份在跑:一张邀请码,或一把对外 API key。
	// 我们把它记进每一笔预约,宿主照着数配额(manifest 的 QuotaDecl.SubjectField)。
	SubjectID      string
	SubjectKind    string
	ConversationID string
	VisitorName    string
	VisitorEmail   string
	RoleID         string
	// NotifyOwner —— 约成后给 owner 发通知信。**这是本能力自己的配置**:manifest 的
	// role_config 声明了 notify_owner,owner 在 role 上填,host 冻进 role snapshot,再经
	// `_meta.capability_config` 原样递给我们。
	//
	// 以前它是 `_meta.notify_owner` —— 一个 host 认识的键,背后是内核 roles 表上一列
	// notify_owner_on_booking。host 那边的注释写着"既不发也不知道 booking notify 是什么",
	// 而列名在说反话。现在 host 递的是一份不透明的 JSON,键名只有这里认识。
	NotifyOwner bool
}

// capConfigOf —— `_meta.capability_config`:本能力自己那份 per-role 配置。
// 缺失 / 类型不符 → 空表(不是错):没设过就走各字段的默认值。
func capConfigOf(raw map[string]any) map[string]any {
	cfg, ok := raw["capability_config"].(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return cfg
}

// boolOf —— 从一份配置里取一个布尔(缺失/类型不符 → false)。
func boolOf(raw map[string]any, key string) bool {
	v, _ := raw[key].(bool)
	return v
}

func sessionFromMeta(req mcpgo.CallToolRequest) session {
	meta := req.Params.Meta
	if meta == nil {
		return session{}
	}
	raw, ok := meta.AdditionalFields["standmeet/session"].(map[string]any)
	if !ok {
		return session{}
	}
	return session{
		OwnerID:        str(raw, "owner_id"),
		SubjectID:      str(raw, "subject_id"),
		SubjectKind:    str(raw, "subject_kind"),
		ConversationID: str(raw, "conversation_id"),
		VisitorName:    str(raw, "visitor_name"),
		VisitorEmail:   str(raw, "visitor_email"),
		RoleID:         str(raw, "role_id"),
		NotifyOwner:    boolOf(capConfigOf(raw), "notify_owner"),
	}
}

func str(m map[string]any, k string) string {
	if v, ok := m[k].(string); ok {
		return v
	}
	return ""
}

// localHandler —— run a sandbox capability fn: pull the trusted session off `_meta`
// (host-planted, never LLM-controlled) + the raw tool arguments, return its wire
// JSON straight through. The capability logic runs HERE in the sandbox; it reaches
// the calendar connector / its own storage / owner meta only via the fixed
// reach-back vocabulary (gateway.go), never a host op it defines itself.
func localHandler(fn func(session, json.RawMessage) string) server.ToolHandlerFunc {
	return func(_ context.Context, req mcpgo.CallToolRequest) (*mcpgo.CallToolResult, error) {
		s := sessionFromMeta(req)
		args, merr := json.Marshal(req.GetArguments())
		if merr != nil {
			return toolErr(merr), nil
		}
		return mcpgo.NewToolResultText(fn(s, json.RawMessage(args))), nil
	}
}

func toolErr(err error) *mcpgo.CallToolResult {
	return mcpgo.NewToolResultText(fmt.Sprintf(`{"ok":false,"error":%q}`, err.Error()))
}

// callHost —— one line-JSON request/response over the host unix socket bound into
// the sandbox at STANDMEET_HOST_SOCKET.
func callHost(reqObj map[string]any) ([]byte, error) {
	path := os.Getenv(socketEnv)
	if path == "" {
		return nil, fmt.Errorf("%s not set", socketEnv)
	}
	conn, derr := net.Dial("unix", path)
	if derr != nil {
		return nil, fmt.Errorf("dial host socket: %w", derr)
	}
	defer func() { _ = conn.Close() }()
	line, merr := json.Marshal(reqObj)
	if merr != nil {
		return nil, merr
	}
	if _, werr := conn.Write(append(line, '\n')); werr != nil {
		return nil, fmt.Errorf("write request: %w", werr)
	}
	sc := bufio.NewScanner(conn)
	sc.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	if !sc.Scan() {
		return nil, fmt.Errorf("no response from host")
	}
	return sc.Bytes(), nil
}
