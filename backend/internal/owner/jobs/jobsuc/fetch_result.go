// fetch_result.go —— 一次 `jobs.fetch_new` 交出去的**形状**：拿到了什么、哪些源没成、
// 每个源这一趟的账。跟 jobs.go 的流程分开放，因为这几样是**回执的契约** ——
// owner 那一侧的 AI 读的就是它们，改动的影响面跟改流程不是一回事。
//
// （分文件的直接原因是 jobs.go 涨过了 350 行的闸门。闸门这次说的是对的：
// 「一次抓取的结果长什么样」和「怎么抓」本来就是两件事。）

package jobsuc

import "github.com/atmaxmoj/standmeet/internal/owner/jobs/jobsmodel"

// FetchResult —— 一次抓取的完整结果:**拿到了什么** + **哪些源没成**。
//
// 收成一个具名结构而不是多返一个值:一次抓取本来就是"部分成功"这种东西,把两半放在一起,
// 调用方就无法只接住其中一半。（三返回值也被 revive 的 function-result-limit 挡了 ——
// 那条闸门这次把代码推去了更好的形状,不是更差的。）
type FetchResult struct {
	Jobs     []jobsmodel.FetchedJob
	Failures []SourceFailure
	// Tallies —— 每个源这一次的账。**没有它，一次取数的结果就无法被判读**：
	// 「HN 回了 1 条」可能是今天真没人招、可能是被限流、可能是判定条件写错，三者
	// 产出完全相同的回执（F-E-19）。数出来，就不必推理 —— 而装置上线后的第一次取数
	// 就用这三个数把 F-E-24 的位置定死了（98 条进来、1 条出去、挡掉 97）。
	Tallies []SourceTally
	// CrossSourceDropped —— 跨源去重挡掉的条数。判据 check 2 问的正是这件事
	// （同一条 posting 从两个源来只留一行），而它以前只能靠「池子总数比两源之和小」
	// 这种算术去推 —— 推出来的结论不算驱过。
	CrossSourceDropped int
}

// SourceTally —— 一个源这一次取数的账：上游给了几条、真进池子几条、被按源去重挡掉几条。
//
// `Seen` 是 adapter 交回来的条数（它自己内部跳过的另算，见各 adapter）；`Pooled` 是这次
// 真正新写进池子的；`Duplicate` = 之前已经见过的同一条。三个数放在一起才回答得了
// 「这次取数到底发生了什么」。
type SourceTally struct {
	SourceID  string `json:"source_id"`
	Label     string `json:"label"`
	Kind      string `json:"kind"`
	Seen      int    `json:"seen"`
	Pooled    int    `json:"pooled"`
	Duplicate int    `json:"duplicate"`
}

// SourceFailure —— 某一个源没抓成，其余源照常。带上 owner 认得出来的东西（label / kind），
// 因为 owner 在 /admin/sources 上看到的是 label，不是 uuid。
type SourceFailure struct {
	SourceID string `json:"source_id"`
	Label    string `json:"label"`
	Kind     string `json:"kind"`
	Reason   string `json:"reason"`
}

// sourceRun —— 一个源跑完的两样东西：进池子的行，和这一趟的账。
// 收成一个结构而不是多返一个值，理由跟 FetchResult 一样：两半必须一起被接住。
type sourceRun struct {
	jobs  []jobsmodel.FetchedJob
	tally SourceTally
}

// failureOf —— 把一个源的失败写成 owner 能据以行动的一行。
// 后端日志里本来就有源 id、kind、URL 和原因；owner 那边曾经只有 "jobs.fetch_new failed"。
// 两边的信息量差了整整一条错误链，而能修这件事的人只有 owner。
func failureOf(src *jobsmodel.JobSource, err error) SourceFailure {
	return SourceFailure{
		SourceID: src.ID,
		Label:    src.Label,
		Kind:     src.Kind,
		Reason:   err.Error(),
	}
}
