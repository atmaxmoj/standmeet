// plan_execute_live_test.go —— four-way comparison: none / query rewrite / query decomposition /
// plan-and-execute. Real LLM, real corpus (583 wiki articles).
//
// None of these three are RAG-specific — this agent issues its own queries, so "rewrite the
// question first or not, decompose it first or not, plan first or not" is its own question,
// unrelated to whether there's a vector pipeline.
//
// The two questions each stress a different shape:
//   Q1 lazy + non-overlapping vocabulary — where rewrite should kick in
//   Q2 needs synthesis across dozens of articles — where decomposition / plan should kick in
//
// **The judging is me reading the answer myself.** This round I already got it wrong three times
// with a string-based scorer ([[read-the-outputs-before-scoring-them]]). Here only two unambiguous
// things are auto-recorded: tool-call count (cost), how many articles were read (coverage).

package main

import (
	"sort"
	"strconv"
	"strings"
	"testing"
)

const (
	// rewritePreamble —— query rewrite: translate the visitor's words into the vocabulary the owner would use, then search.
	rewritePreamble = "The visitor's words are rarely the owner's words. Before you search, " +
		"rewrite their question into the vocabulary the owner's notes would actually use, and " +
		"search with that rewriting rather than with their phrasing."

	// decomposePreamble —— query decomposition: split the question into independent sub-questions first, search each separately.
	decomposePreamble = "Before you search, break the question into the independent " +
		"sub-questions it contains — each one a thing you could look up on its own. Search for " +
		"each sub-question separately, then answer from what all of them returned together."

	// planPreamble —— plan-and-execute: write the plan first, then execute it, rather than deciding one step at a time.
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

// uniqSorted —— tool name → a compact count like "corpus_read×5", so this round's shape is legible at a glance.
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
