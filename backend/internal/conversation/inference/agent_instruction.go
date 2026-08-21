// agent_instruction.go —— 通用 instruction 的组合器:把"访客在看哪篇 doc / 现在
// 几点 + owner & 访客时区 / 该 member 其他对话的 digest"这些**与 capability 无关**的
// 上下文,层层拼进每一轮 ChatModelAgent 的 instruction。
//
// 从 agent_turn.go 拆出来:那边是 HTTP/SSE 出口,这边纯拼 prompt,两个关注点。

package inference

import (
	"strings"
	"time"
)

// instructionWithDoc —— persona instruction 末尾拼一段「访客正看着 X」的位置上下文,
// 让代词指代("this page"/"这篇"/"这个项目")解析到那篇 doc。doc 为 nil / 空 → 原样返。
func instructionWithDoc(system string, doc *AgentDocContext) string {
	if doc == nil || doc.Title == "" {
		return system
	}
	loc := "\n\nContext: the visitor is currently reading the page \"" + doc.Title + "\""
	if doc.Path != "" {
		loc += " (/" + doc.Genre + "/" + doc.Path + ")"
	}
	loc += " on this site. When they say \"this\", \"this page\", \"this doc\", " +
		"\"this project\", or similar without naming it, they mean that document — " +
		"pull it up with your corpus tools if it helps answer."
	return system + loc
}

// instructionWithDateTime —— 把"现在的日期时间 + owner 所在时区 + 访客时区"作为**通用**
// 上下文注入每一轮 instruction(与 capability 无关)。技术 / 简历 / 经历都有
// 时效性:agent 必须知道"今天"才能正确回答"最近""N 年经验"这类问题,也才能把
// "6 月 18 号"这种无年份的相对日期锚到将来而不是某个过去的年份
// (实测里模型会默认 fallback 到训练期的年份,谎报 avail)。tz 空 / 非法 → UTC。
//
// **这里只陈述事实,不下指示。** 原来它还写着"For scheduling, the owner's calendar runs in
// this timezone",以及在访客时区未知时"先问访客时区再提议时间"—— 一个只被授了语料的访客,
// 系统提示里凭空多出一句关于日程的指示,而他连日程工具都看不见。怎么换算、什么时候反问、
// 要不要双显,是**会排期的那个能力**自己的事:它在自己的 MCP instructions 里说,授了才出现
// (mcp-servers/booker/content.go)。内核不知道有没有那个能力,也就不该替它说话。
func instructionWithDateTime(system string, now time.Time, ownerTZ, visitorTZ string) string {
	loc, label := time.UTC, "UTC"
	if ownerTZ != "" {
		if l, err := time.LoadLocation(ownerTZ); err == nil {
			loc, label = l, ownerTZ
		}
	}
	local := now.In(loc)
	return system + "\n\nCurrent date and time: " +
		local.Format("Monday, 2006-01-02 15:04") + " (" + label + "). " +
		"Treat this as \"now\": the owner's experience and any \"recent\" / " +
		"\"N years\" framing is relative to it, and when the visitor names a date " +
		"or time without a year, assume the nearest upcoming occurrence (never a " +
		"past year)." + visitorTZClause(visitorTZ, label)
}

// visitorTZClause —— 访客在哪个时区,**是个事实,不是指示**:知道就说一句,不知道就不说。
// 未知时该不该反问、换算之后要不要两边都报,取决于这一轮有没有会排期的能力 —— 那由它自己说。
func visitorTZClause(visitorTZ, ownerLabel string) string {
	if visitorTZ == "" {
		return ""
	}
	if visitorTZ == ownerLabel {
		return " The visitor is in the same timezone (" + visitorTZ + ")."
	}
	return " The visitor's timezone is " + visitorTZ + "."
}

// instructionWithSessionNotes —— 把**这一场此刻**才成立的事实拼进 instruction。
//
// 为什么不能只写在 system prompt 里:访客那份 prompt 在**发会话时**就定下了(客户端按 part id
// 拼好再发回来)。会话中途才变真的事 —— 额度用完了、连接器掉线了 —— 从那条路进不来。于是
// 一个额度用尽的会话里,模型看见的说明书还写着「你会订会」,手上却没有那把工具,而它对这份
// 证据最自然的修复是怀疑自己刚才的输出:F-B-14 里它把两场**真的**会说成没订成。
//
// 空 → 原样返回:没有新事实时不动那份 instruction(prompt hash 的确定性也靠这一点)。
func instructionWithSessionNotes(system string, notes []string) string {
	if len(notes) == 0 {
		return system
	}
	return system + "\n\nTrue right now in this session:\n" + strings.Join(notes, "\n")
}

// instructionWithCrossConv —— 「互通」:把该 member 其他对话的 digest 拼进 instruction,
// 让 AI 像「同一个人继续聊」那样跨对话连贯,但不把别段的内容混进当前 transcript。
// digest 空(public / 无 member / 没别的对话)→ 原样返回。
func instructionWithCrossConv(system, digest string) string {
	if digest == "" {
		return system
	}
	return system + "\n\nContext from this visitor's other conversations with you " +
		"(separate threads, same person — draw on it naturally when the current question " +
		"connects to it; do not pretend it was said in this thread):\n" + digest
}
