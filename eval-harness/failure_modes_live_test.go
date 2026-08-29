// failure_modes_live_test.go —— 「把这个 agent 弄失败」的四个探针，真 LLM。
//
// 为什么先找失败：前两轮 A/B（整理问题 / 自查）在 12 篇语料上基线全过，两个候选都没有
// 可测的收益。在一个不会失败的地方问"哪个技巧有用"是问不出来的。
//
// 四个探针各打纯 ReAct 循环公认会崩的一处：
//   ① scale     —— 1000+ 篇真语料（不是 12 篇玩具）。一步一步走还找得到吗
//   ② memory    —— 多轮长对话，早期说过的约束到后面还记得吗
//   ③ recovery  —— 工具前两次调用直接报错，它会重试/换路，还是把错当成答案
//   ④ depth     —— 答案埋在四跳之外，需要连续跟链接
//
// **判据落在工具轨迹上**，不写字符串打分器：前三轮 A/B 坏的都是我的打分器，而数字看着
// 像真效应（[[read-the-outputs-before-scoring-them]]）。轨迹是无歧义的；答案我自己读。

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

// realVaultCorpus —— 真 vault 的 wiki 部分。玩具语料上 agent 可以近乎穷举，
// 那正是前两轮实验测不出东西的原因。
func realVaultCorpus(t *testing.T, max int) []agentcore.VisitorCorpusEntry {
	t.Helper()
	root := filepath.Join(os.Getenv("HOME"), "Develop/writing/notes/wiki")
	var out []agentcore.VisitorCorpusEntry
	err := filepath.Walk(root, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() || !strings.HasSuffix(p, ".md") || len(out) >= max {
			return nil //nolint:nilerr // 读不到的单篇跳过,不让一篇坏文件废掉整个语料
		}
		b, rerr := os.ReadFile(p) //nolint:gosec // 固定在 owner 自己的 vault 下
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

// runProbePre —— 带 preamble 的版本。preamble 追加在真 system prompt 之后，
// 模拟"给这个 agent 多加一段操作规程"，其余（工具、人格、预算）逐字不变。
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

// ① scale —— 真语料，懒问题。用词跟笔记不重合，而且候选面从 12 篇变成 1000+。
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

// ② memory —— 多轮。第一轮给一个约束，中间灌几轮无关的，最后看它还认不认。
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
	// 跑 3 次：第一次观察到「中文对话里用英文回答」，一次不算规律，第三次要能判负
	// （[[two-samples-of-a-flake-look-like-a-rule]]）。
	for i := 0; i < 3; i++ {
		r := runProbe2(t, cred, drv, "那他最擅长什么", hist)
		t.Logf("── run%d 多轮后问「那他最擅长什么」（第一轮说过：只看工程，别聊营销/写作）\n"+
			"   工具 %d 次｜答案首句中文? %v\n   答案开头 ↓\n%s",
			i+1, r.nTools, startsChinese(r.answer), firstLines(r.answer, 3))
	}
}

// startsChinese —— 答案开头 40 个字符里有没有汉字。判「回答语言跟提问语言一致吗」够用了。
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

// ③ recovery —— 前两次 corpus_search 报错。看它换工具还是就此收摊。
func TestFailureMode_ToolError(t *testing.T) {
	cred := liveCredOrSkip(t)
	drv := &EvalDriver{cred: cred, corpus: realVaultCorpus(t, 400), FailSearchFirst: 2}
	r := runProbe2(t, cred, drv, "他对可观测性怎么想的", nil)
	t.Logf("── 头两次 search 报错\n   工具 %d 次（search %d）：%v\n   答案 ↓\n%s",
		r.nTools, r.nSearch, r.tools, r.answer)
}

// ④ depth —— 需要连着跟好几跳链接才够得着的问题。纯 ReAct 的"只看一步"在这儿最容易绕路。
func TestFailureMode_Depth(t *testing.T) {
	cred := liveCredOrSkip(t)
	drv := &EvalDriver{cred: cred, corpus: realVaultCorpus(t, 1200)}
	r := runProbe2(t, cred, drv,
		"他笔记里关于「意义」的那条线，从符号学一路连到认知科学，中间都经过了什么？", nil)
	t.Logf("── 多跳问题\n   工具 %d 次（search %d）：%v\n   答案 ↓\n%s",
		r.nTools, r.nSearch, r.tools, r.answer)
}
