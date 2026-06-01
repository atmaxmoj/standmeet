// citation.go —— Citation: 一个 corpus entry 引用 VO。
//
// Dialog.Citations 里挂；admin transcript 跟 visitor chat UI 都按这个
// 形态消费。Genre + Path 是寻址的 (URI = `<genre>://<path>`)；DocID 是
// uuid (持久层落 cited_wiki_ids / cited_output_ids 列时用)；Title 给
// UI 渲。
//
// 单一 VO 涵盖 wiki + output (writing 走 cited 不存表)；之前 backend 拿
// `cited_wiki_ids[]` + `cited_output_ids[]` 两列分着存，frontend 也分两
// 数组维护 —— 现在抽出来。
//
// Genre 用 domain.DocumentGenre (跟 corpus entry 复用同一类型)；引入独
// 立 CitationKind 是残留，已废。

package domain

// Citation —— 一个 corpus entry 引用 VO。
type Citation struct {
	Genre Genre  // wiki / output (其他 genre 当前不引用)
	DocID string // entry uuid (持久层用)
	Path  string // entry path (寻址 + UI 渲)
	Title string // entry title (UI 渲)
}

// Genre —— alias 给 DocumentGenre 用 (Citation.Genre 写起来短一些)。
// 不引入第二个 enum；wiki / output 之外的 DocumentGenre 值传进 Citation
// 是 caller bug。
type Genre = DocumentGenre
