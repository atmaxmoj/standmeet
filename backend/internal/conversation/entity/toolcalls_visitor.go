// toolcalls_visitor.go —— 一轮的 tool_calls 里,哪些能给**访客**看。
//
// F-A-28:访客自己的会话回参把落库的 tool_calls 原样吐了出去,里面是 corpus_read 的完整结果 ——
// 含私有 subjectivity 笔记的正文,和它自己那句 `"show_as_source":false`。同一份回参里 citations
// 是空的:引用那道闸做对了,而这条通道绕开了它。直播那一轮同理。
//
// 为什么剥掉整个 result,而不是按 show_as_source 过滤:
//   • 访客侧**根本不需要**检索结果 —— 界面把 corpus_* 折叠成「searched N · read M」两个数,
//     正文一个字都不渲(tool-call-shape.ts)。发出去的东西没有任何用途,只有风险。
//   • 一条「带着正文、但会遮住私有那些」的通道,离下一个同类缺陷只差一个被忘掉的分支。
//     不带正文的通道没有这个问题。
//
// 非检索工具(booker 的报告卡、summarize 的 html、skill_*/ext_*)的 result 照常保留 —— 那些
// 本来就是渲给访客看的产物。

package entity

import "encoding/json"

// corpusToolPrefix —— 检索族工具的名字前缀。corpus 是内核自己的东西(不是外置能力),
// 所以这一层认识它;认识 booker / mail 那类具体能力才是越界。
const corpusToolPrefix = "corpus_"

// VisitorToolCalls —— 落库的 tool_calls JSON → 可以下发给访客的那一份。
//
// 解析不动就回一个空数组:宁可访客少看见一块折叠计数,也不要把没看懂的东西整段透出去。
func VisitorToolCalls(raw []byte) []byte {
	if len(raw) == 0 {
		return []byte("[]")
	}
	var calls []map[string]json.RawMessage
	if json.Unmarshal(raw, &calls) != nil {
		return []byte("[]")
	}
	for i := range calls {
		stripCorpusResult(calls[i])
	}
	out, err := json.Marshal(calls)
	if err != nil {
		return []byte("[]")
	}
	return out
}

// VisitorToolResult —— 直播那一路:一次工具调用的 result 能不能原样发给访客。
// 检索族回空串(界面只数个数);其余原样 —— 那些是渲给访客看的产物。
func VisitorToolResult(name, result string) string {
	if isCorpusToolName(name) {
		return ""
	}
	return result
}

func isCorpusToolName(name string) bool {
	return len(name) >= len(corpusToolPrefix) && name[:len(corpusToolPrefix)] == corpusToolPrefix
}

// stripCorpusResult —— 是检索调用就把 result 拿掉,名字和 ok 留着(界面只用它们数数)。
func stripCorpusResult(call map[string]json.RawMessage) {
	if !isCorpusCall(call) {
		return
	}
	delete(call, "result")
}

func isCorpusCall(call map[string]json.RawMessage) bool {
	raw, ok := call["name"]
	if !ok {
		return false
	}
	var name string
	if json.Unmarshal(raw, &name) != nil {
		return false
	}
	return isCorpusToolName(name)
}
