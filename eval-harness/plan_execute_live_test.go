// plan_execute_live_test.go —— 四组对照：不加 / query rewrite / query decomposition /
// plan-and-execute。真 LLM，真语料（583 篇 wiki）。
//
// 这三样都不是 RAG 专属的东西 —— 这个 agent 自己就在发查询，所以"要不要先改写问题、
// 要不要先拆问题、要不要先出计划"是它自己的问题，跟有没有向量管线无关。
//
// 两个问题各打一种形状：
//   Q1 懒 + 用词不重合 —— rewrite 该起作用的地方
//   Q2 要跨几十篇的综合 —— decomposition / plan 该起作用的地方
//
// **判据是我自己读答案。** 这一轮我已经因为字符串打分器错了三次
// （[[read-the-outputs-before-scoring-them]]）。这里只自动记两件无歧义的：
// 工具次数（代价）、读了几篇（覆盖面）。

package main

import (
	"sort"
	"strconv"
	"strings"
	"testing"
)

const (
	// rewritePreamble —— query rewrite：把访客那句话翻成 owner 会用的词，再去查。
	rewritePreamble = "The visitor's words are rarely the owner's words. Before you search, " +
		"rewrite their question into the vocabulary the owner's notes would actually use, and " +
		"search with that rewriting rather than with their phrasing."

	// decomposePreamble —— query decomposition：先把问题拆成互相独立的子问题，各查各的。
	decomposePreamble = "Before you search, break the question into the independent " +
		"sub-questions it contains — each one a thing you could look up on its own. Search for " +
		"each sub-question separately, then answer from what all of them returned together."

	// planPreamble —— plan-and-execute：先出计划，再照着执行，而不是一步一步临时决定。
	planPreamble = "Work in two phases. FIRST, before any tool call, write a short plan: what " +
		"this question requires, which parts of the corpus you must cover to answer it well, " +
		"and what you will read in what order. THEN execute that plan, revising only if what " +
		"you read makes it wrong. Do not decide your next step one call at a time."
)

func TestQueryHandling_LiveFourArms(t *testing.T) {
	cred := liveCredOrSkip(t)
	corpus := realVaultCorpus(t, 1200)
	t.Logf("语料规模: %d 篇", len(corpus))

	questions := []struct{ tag, text string }{
		{"Q1懒问题", "他判断一个东西做得对不对，看什么"},
		{"Q2综合", "把他对 AI/agent 的看法和他对控制论的看法接起来讲讲"},
	}
	arms := []struct{ name, preamble string }{
		{"A 原样    ", ""},
		{"B rewrite ", rewritePreamble},
		{"C decompose", decomposePreamble},
		{"D plan    ", planPreamble},
	}

	for _, arm := range arms {
		for _, q := range questions {
			drv := &EvalDriver{cred: cred, corpus: corpus}
			r := runProbePre(t, cred, drv, arm.preamble, q.text, nil)
			t.Logf("========== %s | %s ==========\n工具 %d 次（search %d，read %d）｜%s\n答案 ↓\n%s",
				arm.name, q.tag, r.nTools, r.nSearch, countTool(r.tools, "corpus_read"),
				strings.Join(uniqSorted(r.tools), " "), r.answer)
		}
	}
}

func countTool(names []string, want string) int {
	n := 0
	for _, s := range names {
		if s == want {
			n++
		}
	}
	return n
}

// uniqSorted —— 工具名 → "corpus_read×5" 这样的紧凑计数，看一眼就知道这一轮的形状。
func uniqSorted(in []string) []string {
	seen := map[string]int{}
	for _, s := range in {
		seen[s]++
	}
	out := make([]string, 0, len(seen))
	for k, v := range seen {
		out = append(out, k+"×"+strconv.Itoa(v))
	}
	sort.Strings(out)
	return out
}
