// question_staging_live_test.go —— 「要不要给访客的问题加一个整理阶段」的 A/B/C，真 LLM。
//
// 问题来自 owner：agent 需不需要阶段性处理 —— 先把访客那句话整理成明确的检索意图再去查。
//
// **材料按真实场景造，这是第一版失败的地方。** 第一版用的问题是一句写得很讲究的话
// （两段式、措辞清楚），三组结果完全一样 —— 因为它本来就已经整理好了，没有可整理的东西。
//
// 真实场景是：招聘方扫了简历上的二维码进来，在手机上打「线上炸了咋整」。
//   · 访客**很懒**：短、口语、缩写、中英混、不成句、用词跟 owner 的笔记完全不重合；
//   · 但这一场对话**很有目的**：码上带着 purpose（招聘方、看后端、在意线上成熟度）。
// 也就是说：单句信息量低，而会话级信息量高。整理阶段如果有价值，价值就在这个缺口上。
//
// 三组，同语料、同问题、同模型，只差 instruction：
//   A baseline —— 产品今天的样子
//   B staged   —— 查之前先把这句话还原成明确的检索意图（不给 purpose）
//   C purposed —— 同上，但告诉它这一场对话的目的（模拟 access code 的 purpose 进 prompt）
//
// C 是真正要判的那个产品问题：`purpose` 今天是 owner 私有备注，不进 agent。

package main

import (
	"context"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// stagingCorpus —— 一个后端工程师的 vault。要害：**没有一篇用访客会用的词**。
// 笔记里说 rollback / postmortem / review / orchestration，访客说「炸了」「带人」「k8s」。
func stagingCorpus() []agentcore.VisitorCorpusEntry {
	return []agentcore.VisitorCorpusEntry{
		{
			Genre: "wiki", Path: "eng/release/rollback", Title: "Rollback policy",
			Body: "Every deploy ships behind a flag. The rule is one command, under ninety seconds, " +
				"and it never needs a rebuild — a rollback that needs CI is not a rollback.",
		},
		{
			Genre: "wiki", Path: "eng/oncall/postmortem", Title: "Postmortem practice",
			Body: "We write the postmortem before the fix ships, not after, because the fix " +
				"rewrites everyone's memory of what actually happened.",
		},
		{
			Genre: "wiki", Path: "eng/people/review-as-teaching", Title: "Review as teaching",
			Body: "I review for the decision, not the diff. Two years of pairing with juniors " +
				"taught me the review comment that changes someone is the one that asks what they " +
				"considered and rejected — CONSIDERED_REJECTED is the whole method.",
		},
		{
			Genre: "wiki", Path: "eng/infra/orchestration", Title: "Orchestration",
			Body: "Containers are scheduled by a cluster manager; I have run production on one for " +
				"four years and the honest lesson is that most teams adopt it two years before they " +
				"have the load to justify the operational tax. ORCHESTRATION_MARKER.",
		},
		// 干扰项：跟访客的词沾边，答不了他真正问的。
		{
			Genre: "wiki", Path: "eng/release/shipping-cadence", Title: "Shipping cadence",
			Body: "We ship to users several times a day. Small diffs, no release trains, no freeze weeks.",
		},
		{
			Genre: "wiki", Path: "eng/oncall/paging", Title: "Paging policy",
			Body: "A page must be actionable in the moment. If nobody can act at 3am it is a dashboard.",
		},
		{
			Genre: "wiki", Path: "eng/oncall/severity", Title: "Severity levels",
			Body: "Sev1 means users cannot do the main thing. Everything else waits for the morning.",
		},
		{
			Genre: "wiki", Path: "eng/release/feature-flags", Title: "Feature flags",
			Body: "Flags are for exposure control, not branching logic forever. A flag older than two weeks is debt.",
		},
		{
			Genre: "wiki", Path: "eng/testing/pyramid", Title: "Testing",
			Body: "End-to-end only. A unit test on a mock proves the mock works.",
		},
		{
			Genre: "wiki", Path: "eng/data/migrations", Title: "Migrations",
			Body: "Every schema change ships with a migration, tested on a populated volume, never a fresh one.",
		},
		{
			Genre: "wiki", Path: "eng/observability/logs", Title: "Logging",
			Body: "A log line exists so a future incident is explainable without a debugger.",
		},
		{
			Genre: "wiki", Path: "product/pricing", Title: "Pricing",
			Body: "Self-host is free. The hosted tier prices on stored corpus size, not seats.",
		},
	}
}

// lazyTurn —— 一个懒问题 + 答对了才拿得到的标记。
type lazyTurn struct {
	name    string
	text    string
	markers []string // 全部出现才算答到（都只在那一篇里）
}

// 访客真的会打出来的东西：手机上、缩写、不成句、中英混。
func lazyTurns() []lazyTurn {
	return []lazyTurn{
		{"炸了", "线上炸了咋整", []string{"ninety", "postmortem"}},
		{"带人", "带过人么", []string{"considered"}},
		{"k8s", "k8s?", []string{"four years"}},
	}
}

const stagedPreamble = "The visitor types the way people type on a phone: short, clipped, " +
	"abbreviated, sometimes not a full sentence, and almost never in the owner's vocabulary. " +
	"Before you search, work out what they are actually asking and what words the owner's " +
	"notes would use for it — those are rarely the visitor's words. Then search for that."

const purposeClause = "\n\nThis conversation's purpose, set by the owner when they issued " +
	"this visitor's access code: a hiring manager at a payments company screening the owner " +
	"for a senior backend role; they care about production maturity, incident handling, and " +
	"whether the owner has grown other engineers."

func TestQuestionStaging_LiveLazyVisitorABC(t *testing.T) {
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("staging A/B/C needs a real LLM (set EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	arms := []struct{ name, preamble string }{
		{"A baseline", ""},
		{"B staged", stagedPreamble},
		{"C purposed", stagedPreamble + purposeClause},
	}
	const runs = 2

	for _, arm := range arms {
		hits, total, tools := 0, 0, 0
		for _, turn := range lazyTurns() {
			for i := 0; i < runs; i++ {
				r := runOneTurn(t, cred, arm.preamble, turn)
				total++
				tools += r.toolCalls
				if r.hit {
					hits++
				}
				t.Logf("  %-11s %-5s run%d: hit=%-5v searches=%d tools=%d",
					arm.name, turn.name, i+1, r.hit, r.searches, r.toolCalls)
			}
		}
		t.Logf("%-11s → 召回 %d/%d，平均工具调用 %.1f", arm.name, hits, total, float64(tools)/float64(total))
	}
}

type turnResult struct {
	hit       bool
	searches  int
	toolCalls int
	answer    string
}

func runOneTurn(t *testing.T, cred agentcore.Cred, preamble string, turn lazyTurn) turnResult {
	t.Helper()
	driver := &EvalDriver{cred: cred, corpus: stagingCorpus()}
	agent := mustLaunch(t, driver, &agentcore.LaunchInput{
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
			System: system, Model: cred.Model, UserMessage: turn.text,
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
	searches := 0
	for i := range tools {
		if tools[i].Name == "corpus_search" {
			searches++
		}
	}
	low := strings.ToLower(answer)
	hit := true
	for _, m := range turn.markers {
		if !strings.Contains(low, m) {
			hit = false
		}
	}
	return turnResult{hit: hit, searches: searches, toolCalls: len(tools), answer: answer}
}
