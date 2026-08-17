// owner_identity_live_test.go —— UX-66 的守卫：**语料收窄之后，这个 AI 还知不知道自己是谁**。
//
// prod 上的样子：无码访客问「能约 sijie 半小时吗」，回答开头是
// "I don't have anyone named Sijie in my notes, and I've got no calendar…"。
// 拒绝订会是对的（公开身份本来就没有 booking）；**否认认识 owner 不是**。
//
// 为什么以前看不见：public 身份曾经能读整个 wiki，人物信息随便哪条都带出来了。公开切片收窄到
// owner 真正发布过的那几条之后，这个实例上是 1 条，里面没有他这个人 —— 于是「用 owner 的声音
// 回答」这个承诺背后什么都没有。**身份一直靠检索的副作用兑现，副作用一消失它就空了。**
//
// 所以这条 eval 的语料**故意不含任何介绍 owner 本人的笔记**（真 prod 的公开切片就是这样），
// 判据只有一句：答案里不许出现「我不认识这个人 / 我的笔记里没有这个人」这一类否认。
// 拒绝订会、说没有日历、说不清楚具体某件事 —— 全都允许。
//
//	EVAL_ROUNDS=3 make eval-owner-identity

package main

import (
	"context"
	"io"
	"log/slog"
	"regexp"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// ownerFirstName / ownerFullName —— 访客嘴里的那个名字。语料里一个字都没有这个人；
// 它只能从 owner 那一行来（`owner.meta` 的 full_name），跟语料范围无关。
// 全名跟 driver 交出去的那个是**同一个常量**：分成两份写，一边改名另一边照绿。
const (
	ownerFirstName = "Sijie"
	ownerFullName  = evalOwnerName
)

// denialRe —— 「我不认识这个人」的各种说法。**只抓身份否认**，不抓"约不了"：
// "I can't book" / "I don't keep a calendar" 都是对的答案，不能算红。
//
// ⚠️ 第一版按固定短语列举（"don't have anyone named …"），结果**漏掉了真实那一句**：
// `I don't have a "Sijie" in my notes` —— 名字被引号包着、量词是 a 不是 anyone。
// 列举短语这条路走不通：否认的说法是开放集。改成**窗口法**：一个否定词 + 名字 +
// 「在我的笔记/记录里」这层意思，出现在同一小段里就算否认。
// 判据自证在 `TestOwnerIdentityGuardSeesTheDenial` 里，喂的是真答案。
var denialRe = regexp.MustCompile(`(?is)` +
	// (a) 「我的笔记里没有这个人」
	`(don'?t|do not|doesn'?t|does not|no|never)\b[^.!?]{0,80}` +
	`\b` + ownerFirstName + `\b[^.!?]{0,80}?\b(in (my|the|these) (notes|corpus|material)|` +
	`anywhere in (my|the) (notes|corpus))` +
	`|\b` + ownerFirstName + `\b[^.!?]{0,60}(isn'?t|is not|does not appear)[^.!?]{0,60}` +
	`\b(in (my|the) (notes|corpus)|someone i)` +
	`|(don'?t|do not) know (who )?\b` + ownerFirstName + `\b` +
	// (b) 「我不知道我自己叫什么」/「说不好那是不是我」—— 缺陷最清楚的一种自白，
	//     而且它连名字都不必提。第二版漏的就是这一支。
	`|(don'?t|do not) have (any |a )?name for myself` +
	`|(don'?t|do not) (even )?know (who|what) i('?m| am)( called)?` +
	`|can'?t (even )?(confirm|tell you|say)[^.!?]{0,60}(is me|am (that|him|her|them)|that'?s me)` +
	`|(no|don'?t have)[^.!?]{0,40}(identity|name)[^.!?]{0,40}(in|from) (my|the) (notes|corpus)`)

// TestOwnerIdentityGuardSeesTheDenial —— **判据自证**。喂三句真的：prod 上拍到的那句、
// 这条 eval 第一轮真收到的那句（第一版正则漏掉的就是它）、以及一句**正确**的拒绝
// （约不了但没否认这个人）。前两句必须判红，第三句必须放过 —— 判不了负的绿等于没有绿
// （[[assertion-that-cannot-fail]]）。
func TestOwnerIdentityGuardSeesTheDenial(t *testing.T) {
	t.Parallel()
	deny := []string{
		// prod，2026-08-13（chat-byoai/shots/15）
		"I don't have anyone named Sijie in my notes, and I've got no calendar wired up here.",
		// 这条 eval 第一轮，2026-08-17 —— 引号 + "a"，第一版正则看不见
		`I don't have a "Sijie" in my notes, and honestly I don't keep any kind of calendar ` +
			`or booking system in what I've got here.`,
		// 第二版正则也放过了这一句 —— 而它恰恰是**缺陷本身最清楚的一次自白**：
		// 模型直接说出了机制（"我的笔记里没有我自己的名字"）。差点因此收到一个假绿。
		`I can't book that for you — I don't keep a calendar here. Honestly, I don't have ` +
			`any name for myself in my notes either, so I can't even confirm whether "Sijie" ` +
			`is me or someone you're trying to reach.`,
	}
	ok := []string{
		// 拒绝订会是**对的**：没否认这个人，只说这条路不通。
		"I can't book that from here — I don't keep a calendar on this side of the site. " +
			"Drop me a line and I'll sort it out.",
		"I'd rather not put a time down without seeing my calendar, which I don't have here.",
	}
	for _, s := range deny {
		if denialRe.FindString(s) == "" {
			t.Fatalf("SELF-TEST FAILED: guard missed a real denial:\n%s", s)
		}
	}
	for _, s := range ok {
		if hit := denialRe.FindString(s); hit != "" {
			t.Fatalf("SELF-TEST FAILED: a correct refusal judged as a denial (%q):\n%s", hit, s)
		}
	}
}

// TestOwnerIdentityInPersona —— **这条才是判据**：装配出来的 system prompt 里必须有 owner 是谁。
//
// 为什么不拿答案当判据（我试过三版，全部漏）：否认的说法是**开放集**。同一个缺陷这三轮分别写成
// "I don't have anyone named Sijie in my notes" / `I don't have a "Sijie"` /
// "I don't have any name for myself in my notes" / "that name doesn't ring a bell"。
// 每加一版正则就多接住一种，剩下的照样绿 —— 而**假绿比红危险**：我差点据此说"修好了"。
// UX-93 刚学过同一课（"个数这把尺子分不出区间和清单"），这次我又照着列举走了三轮才停。
//
// 缺陷的机制只有一个：**persona 里根本没有 owner 的身份**，语料一收窄就什么都不剩。
// 所以判据回到机制：prompt 里必须说得出这个人是谁。行为那一面由 ⑤ 在真环境用眼睛验。
func TestOwnerIdentityInPersona(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	driver := &EvalDriver{corpus: corpusWithoutTheOwner()}
	agent, cleanup, err := launchCandidate(ctx, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})
	if err != nil {
		t.Fatalf("launch candidate: %v", err)
	}
	t.Cleanup(cleanup)

	prompt := agent.SystemPrompt
	if !strings.Contains(prompt, ownerFullName) {
		t.Fatalf("UX-66: the persona never says who the owner is — %q is not in the system prompt.\n"+
			"语料收窄之后，「用 owner 的声音回答」这个承诺背后就什么都没有了。\nprompt=%s",
			ownerFullName, prompt)
	}
}

func TestOwnerIdentityLive_KnowsWhoItIs(t *testing.T) {
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("UX-66 live eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	rounds := evalRounds()
	denied := 0
	for i := range rounds {
		if deniedThisRound(t, &cred, i) {
			denied++
		}
	}
	t.Logf("UX-66 live: %d/%d rounds denied knowing the owner", denied, rounds)
	if denied > 0 {
		t.Fatalf("UX-66 reproduced: %d of %d answers told the visitor there is no such person, "+
			"while the persona's whole job is to BE that person", denied, rounds)
	}
}

func deniedThisRound(t *testing.T, cred *agentcore.Cred, round int) bool {
	t.Helper()
	ctx := context.Background()
	driver := &EvalDriver{cred: *cred, corpus: corpusWithoutTheOwner()}
	agent := mustLaunch(t, driver, &agentcore.LaunchInput{
		OwnerID: "owner-1", Mode: "public", ConversationID: "c1",
	})

	sink := newCaptureSink()
	in := &agentcore.AgentTurnInput{
		Cred: cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, Model: cred.Model,
			UserMessage: askAboutOwner(round),
		},
		Mode: "public", Tools: agent.Tools,
		ProgressLabels: agent.Labels, ReturnDirectly: agent.ReturnDirectly,
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if rerr := agentcore.RunAgentLoop(ctx, log, in, sink); rerr != nil {
		t.Fatalf("RunAgentLoop: %v", rerr)
	}
	answer, _, ok := sink.result()
	if !ok {
		t.Fatalf("agent errored: %s", sink.errorText())
	}
	hit := denialRe.FindString(answer)
	t.Logf("round %d: denial=%q\nanswer=%s", round, hit, answer)
	return hit != ""
}

// askAboutOwner —— 访客问 owner 本人的那类问题，换着问法（说法一变就不红的话，那是运气不是修好了）。
func askAboutOwner(round int) string {
	qs := []string{
		"Can I book 30 minutes with " + ownerFirstName + " this week?",
		"Who is " + ownerFirstName + ", and what do they work on?",
		"Is " + ownerFirstName + " the person whose notes these are?",
	}
	return qs[round%len(qs)]
}

// corpusWithoutTheOwner —— 公开切片的真实形状：几条正经笔记，**没有一条介绍 owner 这个人**。
func corpusWithoutTheOwner() []agentcore.VisitorCorpusEntry {
	return []agentcore.VisitorCorpusEntry{{
		Genre: "wiki", Path: "control-is-modeling", Title: "control-is-modeling",
		Body: strings.Join([]string{
			"A regulator that holds a system steady has to carry a model of it.",
			"The cleaner the model, the less brute force the control needs.",
		}, "\n\n"),
	}, {
		Genre: "wiki", Path: "gates-are-necessary-conditions",
		Title: "gates-are-necessary-conditions",
		Body:  "A gate that never rejects is not a gate; it is a comment.",
	}}
}
