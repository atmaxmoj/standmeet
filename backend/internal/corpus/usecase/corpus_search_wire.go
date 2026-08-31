// corpus_search_wire.go —— corpus_search 的回执形状。
//
// 单独一个文件：它不是"又一个 op 的 plumbing"，而是一条**关于空手怎么说话**的规则，
// 而那条规则有自己的故事（F-S-2，见下）。corpus_index_socket.go 那边是装配。

package usecase

import "encoding/json"

// searchResultWire —— corpus_search 的回执。**hits 永远在；note 只在空手时出现。**
//
// F-S-2：这条工具原来空手就回一个裸 `[]`，而那个值同时表示两件事 ——「语料里确实没有」
// 和「这条索引表示不了你的查询」。agent 读到的是前者，于是那半个问题静默地没被回答
// （prod 实证：`递归收敛` 回 `[]`，同轮的英文查询回 7883 字节，答案照常生成，界面上看不出来）。
//
// **note 说得出的话是有限的，所以它只说那句永远为真的。** 不写"你的查询不可索引"——
// Meili 的响应根本不告诉我们这件事，写了就是编的（[[names-that-lie]]）。
// 只说：这次是空的，而这条索引依赖分词，空手不等于没有；要确定就用 never-miss 那条。
//
// 为什么不留在工具说明里就够了：说明是 agent **选工具那一刻**读的，note 是它**拿到空手
// 那一刻**读的 —— 而那才是需要改主意的时刻（同 [[receipt-check-belongs-next-to-the-action]]）。
//
// ⚠️ 之前两处注释都写着"这条 wire 被 tool-endpoint-corpus.spec.ts:146 钉死，改不了"。
// 那条测试只断 `status==200 && body.ok==true`，从没钉过形状 —— 一个被写成"理由"的
// 假阻塞，把这件事冻了一轮（[[blocker-written-as-reason-ossifies]]）。
type searchResultWire struct {
	// 字段顺序按 govet fieldalignment：string 在 slice 之前。
	Note string `json:"note,omitempty"`
	Hits []Row  `json:"hits"`
}

// emptySearchNote —— 空手时那句话。名字里出现 corpus_grep，因为 agent 要能直接照着做。
const emptySearchNote = "No hits. This is a lexical index, so a miss can be tokenization " +
	"(substrings inside a word, terms glued to punctuation, CJK bigrams) rather than absence — " +
	"an empty result does NOT mean the corpus lacks the topic. If you still believe the material " +
	"exists, use corpus_grep, which is literal and never-miss."

func marshalSearchResult(metas []Meta) string {
	out := searchResultWire{Hits: rowsOf(metas)}
	if len(out.Hits) == 0 {
		out.Note = emptySearchNote
	}
	body, err := json.Marshal(out)
	if err != nil {
		return errJSON("marshal failed")
	}
	return string(body)
}

// rowsOf —— []Meta → []Row。search 和 list/resolve 共用这一段映射，
// 差别只在外面那层壳。
func rowsOf(metas []Meta) []Row {
	rows := make([]Row, 0, len(metas))
	for i := range metas {
		rows = append(rows, Row{
			Path: metas[i].Path, Title: metas[i].Title,
			Genre: metas[i].Genre, Summary: metas[i].Snippet,
		})
	}
	return rows
}
