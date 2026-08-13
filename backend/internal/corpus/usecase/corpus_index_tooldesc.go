// corpus_index_tooldesc.go —— 语料检索工具**给 agent 读的那句话**。
//
// 从 corpus_index_socket.go 拆出来:那边是接线(谁跑、叫什么、参数怎么解),这边是**选择依据**。
// agent 是在读说明的那一刻决定用哪条检索路的,所以这句话的措辞跟运行时行为一样是产品的一部分,
// 不是注释。分开放,改说明时不必碰接线,改接线时也不会顺手把说明改短。

package usecase

// searchToolDesc —— corpus_search 的说明。**必须写明它会漏**(F-S-2)。
//
// 这是一条词法索引:命中与否取决于分词器,而分词器切不动的东西(词中子串、紧贴标点、CJK 双字)
// 会直接查不到 —— 空结果因此**不等于**语料里没有这个主题。真实证据:`递归收敛` 在一份带整段
// 中文的语料上返回 `[]`,同一轮的英文查询却拿回 7883 字节,而 agent 不知道该换路,那半个问题
// 就静默地没被回答。
//
// 名字要出现在这句话里:corpus_grep 是为这个建的第二条路(never-miss)。
// **提示只能挂在这里**:空数组那条 wire 被 `tool-endpoint-corpus.spec.ts:146` 钉死
// (scope 里没东西必须回 `[]`),而那条约束有正当理由 —— 于是"scope 里没有"和"分词器表示不了"
// 这两种空今天挤在同一个值上,分不开。分开它们要给检索工具加第二条「为什么空」的通道,
// 那是产品决策,记在 F-S-2。
const searchToolDesc = "Search the corpus under this session's ACL scope. This is a lexical " +
	"index, so a hit depends on how the text was tokenized: substrings inside a word, terms " +
	"glued to punctuation, and CJK bigrams can all miss. An empty result therefore does NOT " +
	"mean the corpus lacks the topic — when it comes back empty and you still believe the " +
	"material exists, use corpus_grep, which is literal and never-miss."
