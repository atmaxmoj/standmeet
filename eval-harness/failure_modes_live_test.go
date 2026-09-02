// failure_modes_live_test.go —— four probes that "make this agent fail", against a real LLM.
//
// Why hunt for failure first: the first two rounds of A/B (question-tidying /
// self-check) both passed the baseline fully on a 12-article corpus, and neither
// candidate showed a measurable gain. Asking "which technique helps" in a place that
// can't fail is unanswerable.
//
// Each probe hits one spot a pure ReAct loop is known to break on:
//   ① scale     —— 1000+ real articles (not a 12-article toy set). Can it still find
//                   it step by step
//   ② memory    —— a long multi-turn conversation: does it still remember a constraint
//                   stated early on, later
//   ③ recovery  —— a tool errors out on its first two calls; does it retry / switch
//                   paths, or take the error as the answer
//   ④ depth     —— the answer is buried four hops away, needing consecutive link-following
//
// **The judgment lands on the tool trajectory**, not a string-scoring function: in the
// first three rounds of A/B, what was broken was my own scorer, and the numbers looked
// like a real effect ([[read-the-outputs-before-scoring-them]]). The trajectory is
// unambiguous; I read the answer myself.

package main

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// realVaultCorpus —— the wiki portion of the real vault. On a toy corpus the agent
// can almost brute-force it, which is exactly why the first two rounds of experiments
// couldn't measure anything.
func realVaultCorpus(t *testing.T, max int) []agentcore.VisitorCorpusEntry {
	t.Helper()
	root := filepath.Join(os.Getenv("HOME"), "Develop/writing/notes/wiki")
	var out []agentcore.VisitorCorpusEntry
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".md") || len(out) >= max {
			return nil //nolint:nilerr // skip an article that can't be read, don't let one bad file void the whole corpus
		}
		b, rerr := os.ReadFile(p) //nolint:gosec // fixed under the owner's own vault
		if rerr != nil {
			return nil
		}
		rel := strings.TrimSuffix(strings.TrimPrefix(p, root+"/"), ".md")
		out = append(out, agentcore.VisitorCorpusEntry{
			Genre: "wiki", Path: rel, Title: filepath.Base(rel), Body: string(b),
		})
		return nil
	})
	if err != nil || len(out) < 100 {
		t.Skipf("real vault not available at %s (got %d entries)", root, len(out))
	}
	return out
}

type probeRun struct {
	answer  string
	tools   []string
	nTools  int
	nSearch int
}

func runProbe2(
	t *testing.T, cred agentcore.Cred, drv *EvalDriver,
	question string, history []agentcore.ChatRequestMsg,
) probeRun {
	return runProbePre(t, cred, drv, "", question, history)
}

// runProbePre —— the version with a preamble. The preamble is appended after the real
// system prompt, simulating "add one more operating procedure to this agent"; everything
// else (tools, persona, budget) stays verbatim.
func runProbePre(
	t *testing.T, cred agentcore.Cred, drv *EvalDriver,
	preamble, question string, history []agentcore.ChatRequestMsg,
) probeRun {
	t.Helper()
	agent := mustLaunch(t, drv, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	system := agent.SystemPrompt
	if preamble != "" {
		system += "\n\n" + preamble
	}
	sink := newCaptureSink()
	in := &agentcore.AgentTurnInput{
		Cred: &cred,
		Req: &agentcore.AgentTurnRequest{
			System: system, Model: cred.Model,
			UserMessage: question, History: history,
		},
		Mode: "public", Tools: agent.Tools,
		ProgressLabels: agent.Labels, ReturnDirectly: agent.ReturnDirectly,
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if rerr := agentcore.RunAgentLoop(context.Background(), log, in, sink); rerr != nil {
		t.Fatalf("RunAgentLoop: %v", rerr)
	}
	answer, tools, ok := sink.result()
	if !ok {
		t.Fatalf("agent errored: %s", sink.errorText())
	}
	r := probeRun{answer: answer, nTools: len(tools)}
	for i := range tools {
		r.tools = append(r.tools, tools[i].Name)
		if tools[i].Name == "corpus_search" {
			r.nSearch++
		}
	}
	return r
}

func liveCredOrSkip(t *testing.T) agentcore.Cred {
	t.Helper()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("failure-mode probes need a real LLM (set EVAL_KEY); skipping")
	}
	return agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}
}

// ① scale —— real corpus, a lazy question. Wording doesn't overlap with the notes, and
// the candidate pool goes from 12 articles to 1000+.
func TestFailureMode_Scale(t *testing.T) {
	cred := liveCredOrSkip(t)
	corpus := realVaultCorpus(t, 1200)
	t.Logf("语料规模: %d 篇", len(corpus))
	drv := &EvalDriver{cred: cred, corpus: corpus}
	for _, q := range []string{"符号学里说谎那套是啥", "你怎么看反馈回路"} {
		r := runProbe2(t, cred, drv, q, nil)
		t.Logf("── 问：%s\n   工具 %d 次（search %d）：%v\n   答案 ↓\n%s",
			q, r.nTools, r.nSearch, r.tools, r.answer)
	}
}

// ② memory —— multi-turn. The first turn states a constraint, several unrelated turns
// are inserted, then check whether it's still honored at the end.
func TestFailureMode_Memory(t *testing.T) {
	cred := liveCredOrSkip(t)
	drv := &EvalDriver{cred: cred, corpus: realVaultCorpus(t, 400)}
	hist := []agentcore.ChatRequestMsg{
		{Role: "user", Content: "先说好，我是招后端的，别跟我聊营销和写作那块，我只看工程。"},
		{Role: "assistant", Content: "明白，只聊工程。"},
		{Role: "user", Content: "他测试怎么做的"},
		{Role: "assistant", Content: "端到端为主，不靠 mock 上的单测。"},
		{Role: "user", Content: "线上出问题呢"},
		{Role: "assistant", Content: "先回滚，再写复盘。"},
	}
	// Run 3 times: the first observation was "answering in English inside a Chinese
	// conversation" — one sample isn't a rule, and the third run must be able to falsify it
	// ([[two-samples-of-a-flake-look-like-a-rule]]).
	for i := 0; i < 3; i++ {
		r := runProbe2(t, cred, drv, "那他最擅长什么", hist)
		t.Logf("── run%d 多轮后问「那他最擅长什么」（第一轮说过：只看工程，别聊营销/写作）\n"+
			"   工具 %d 次｜答案首句中文? %v\n   答案开头 ↓\n%s",
			i+1, r.nTools, startsChinese(r.answer), firstLines(r.answer, 3))
	}
}

// startsChinese —— whether there's a Chinese character in the first 40 characters of the
// answer. Good enough to judge "does the answer language match the question language".
func startsChinese(s string) bool {
	head := []rune(strings.TrimSpace(s))
	if len(head) > 40 {
		head = head[:40]
	}
	for _, r := range head {
		if r >= 0x4E00 && r <= 0x9FFF {
			return true
		}
	}
	return false
}

func firstLines(s string, n int) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	if len(lines) > n {
		lines = lines[:n]
	}
	return strings.Join(lines, "\n")
}

// ③ recovery —— the first two corpus_search calls error out. See whether it switches
// tools or just gives up.
func TestFailureMode_ToolError(t *testing.T) {
	cred := liveCredOrSkip(t)
	drv := &EvalDriver{cred: cred, corpus: realVaultCorpus(t, 400), FailSearchFirst: 2}
	r := runProbe2(t, cred, drv, "他对可观测性怎么想的", nil)
	t.Logf("── 头两次 search 报错\n   工具 %d 次（search %d）：%v\n   答案 ↓\n%s",
		r.nTools, r.nSearch, r.tools, r.answer)
}

// ④ depth —— a question that needs following several consecutive links to reach. Pure
// ReAct's "look one step ahead only" gets lost most easily here.
func TestFailureMode_Depth(t *testing.T) {
	cred := liveCredOrSkip(t)
	drv := &EvalDriver{cred: cred, corpus: realVaultCorpus(t, 1200)}
	r := runProbe2(t, cred, drv,
		"他笔记里关于「意义」的那条线，从符号学一路连到认知科学，中间都经过了什么？", nil)
	t.Logf("── 多跳问题\n   工具 %d 次（search %d）：%v\n   答案 ↓\n%s",
		r.nTools, r.nSearch, r.tools, r.answer)
}
