// Package i18n —— 一条笔记的多语结构:解析、校验、按语言取。
//
// 契约就是嵌套 callout 本身,frontmatter 全是可选的:
//
//	> [!i18n]
//	> > [!lang] en
//	> > # Title
//	> > ...
//	>
//	> > [!lang] zh
//	> > # 标题
//	> > ...
//
// 三件事写在结构里,不写在 lint 里:
//
//   - **一条笔记就是一条笔记**,不是 N 份文档。`[!i18n]` 区块之外的散文是**语言中性**的,
//     每种语言下都要出现;拆成 N 份文档的话那些散文会被复制 N 份,搜索也会给出 N 条命中。
//   - **每个 pane 自己声明语言码**。frontmatter 的 langs 跟 pane 对不上时**信 pane** ——
//     它离内容最近。对不上要报出来,但不改内容。
//   - **推断缺的,绝不改写写着的**。没有 langs 就从 pane 推;写了但不一致就报。
//     一个 pane 都对不上要的语言 → 整条退回 lang(身份语言),而不是猜一个贴上去。
//
// N 无上限:vault 那份 lint 里的 "2..3" 不是设计,是 CSS 里手写了三条 nth-of-type 规则。
package i18n

import "regexp"

// Severity —— 诊断的轻重。Error 会让 MCP 写入被拒;Warning 只报告(同步照收)。
type Severity string

const (
	// SeverityError —— 这条笔记的多语结构坏了,渲染要退回单语。
	SeverityError Severity = "error"
	// SeverityWarning —— 能渲染,但有话要说(翻译质量 / 声明与内容不一致)。
	SeverityWarning Severity = "warning"
)

// Diagnostic —— 一条诊断。Code 给机器分流,Message 给人和 agent 读。
type Diagnostic struct {
	Code     string   `json:"code"`
	Message  string   `json:"message"`
	Severity Severity `json:"severity"`
}

// Frontmatter —— 校验要看的那几个字段,全部可选。
type Frontmatter struct {
	LangLabels map[string]string
	Lang       string
	Langs      []string
}

var (
	// reCalloutMarker —— callout 首行:`[!type] 可选标题`。
	reCalloutMarker = regexp.MustCompile(`^\[!([\w-]+)\][+-]?[ \t]*(.*)$`)
	// reFence —— 围栏代码块(``` 或 ~~~)。tikz 块里的 `[!i18n]` 不是区块 ——
	// 这是那份 lint 用惨痛代价学到的一条,照抄。
	reFence = regexp.MustCompile("^\\s*(```|~~~)")
)
