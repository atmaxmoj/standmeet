package mcpplugin

import "unicode"

// ProgressLabel —— 一个能力在跑的时候，**访客**那一行看到什么。
//
// 住在这里而不是加载器里，是因为这是能力自己的属性：「我在做什么」该由声明这个能力的东西
// 回答，而不是由碰巧把它装进来的那段代码决定。（routes-cyclo 那条闸门先发现了这件事 ——
// 它拦的是"face 里长出了分支"，而分支之所以在那儿，正是因为归属放错了地方。）
//
// 优先级：
//  1. tool 自己在 `_meta.progress_label` 里声明的（外置内建保各自原文案：
//     corpus_search "searching corpus"）。
//  2. manifest 的 Title —— **必填、且 owner 已经在 dock 下拉里审过一遍**。
//  3. 兜底一句人话。
//
// 为什么第 2 条是关键（UX-55）：这里以前直接跳到一个字面量 `"calling plugin"`，而这行字是
// **访客**看到的。访客问「能给我一份可以发给团队的总结吗」，屏幕回他一个宿主的架构名词。
// 而人话名字一直都在 —— `summarize_conversation` 的 manifest 写着
// `title: Summarize the conversation`，owner 侧的 dock 下拉透传的就是它。
// **纪律存在、被执行，只是没跟到访客那条路上**（[[move-the-capability-move-its-edges]]）。
//
// 所以修法不是"再加一个 progress_label 字段等下一个能力去填" —— 那个字段照样会被忘。
// 退到已经必填的 Title，任何能力都白得一句人话。
func ProgressLabel(m *Manifest, declared string) string {
	if declared != "" {
		return declared
	}
	if m != nil && m.Title != "" {
		return lowerFirst(m.Title)
	}
	return "working"
}

// lowerFirst —— throbber 那一行是句中片段（"searching corpus···"），首字母压平，
// 让 Title 读起来跟其它进度文案同一个调子，而不是一句突兀的标题。
func lowerFirst(s string) string {
	r := []rune(s)
	if len(r) == 0 {
		return s
	}
	return string(unicode.ToLower(r[0])) + string(r[1:])
}
