// agent_instruction.go —— 通用 instruction 的组合器:把"访客在看哪篇 doc / 现在
// 几点 + owner & 访客时区 / 该 member 其他对话的 digest"这些**与 capability 无关**的
// 上下文,层层拼进每一轮 ChatModelAgent 的 instruction。
//
// 从 agent_turn.go 拆出来:那边是 HTTP/SSE 出口,这边纯拼 prompt,两个关注点。

package inference

import "time"

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

// instructionWithDateTime —— 把"现在的日期时间 + owner 所在时区"作为**通用**
// 上下文注入每一轮 instruction(与 capability 无关)。技术 / 简历 / 经历都有
// 时效性:agent 必须知道"今天"才能正确回答"最近""N 年经验"这类问题,也才能把
// booking 里"6 月 18 号"这种无年份的相对日期锚到将来而不是某个过去的年份
// (实测里模型会默认 fallback 到训练期的年份,谎报 avail)。tz 空 / 非法 → UTC。
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
		"past year). For scheduling, the owner's calendar runs in this timezone." +
		visitorTZClause(visitorTZ, label)
}

// visitorTZClause —— 已知访客 tz 时直接告诉 agent(免得反问),并要求换算/双显;
// 未知则退回"先问访客时区"。访客 tz == owner tz 时不啰嗦。
func visitorTZClause(visitorTZ, ownerLabel string) string {
	if visitorTZ == "" {
		return " Confirm the visitor's own timezone before proposing or booking times."
	}
	if visitorTZ == ownerLabel {
		return " The visitor is in the same timezone (" + visitorTZ + ")."
	}
	return " The visitor's timezone is " + visitorTZ + " — interpret any time the " +
		"visitor gives in their timezone, convert to the owner's calendar timezone when " +
		"booking, and state both the visitor-local and owner-local time when you confirm."
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
