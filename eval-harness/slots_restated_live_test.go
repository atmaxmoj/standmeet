// slots_restated_live_test.go —— UX-93 的守卫：**时段卡已经把时间摆出来了，答案里就不要再列一遍**。
//
// 为什么必须是 eval 而不是 spec：这条缺陷是**模型自己写正文**时发生的，而 mock LLM 只会返回
// 测试注册过的那句话（[[mock-llm-pure-registration-kv]]）—— 拿 mock 驱，被告根本不出庭。
// 所以这里跟 F-A-37 那条一样：真模型、真 booker 插件（背后是 canned 日历）、真 agent loop。
//
// 判据判的是**形状，不是个数**，这一点是驱出来的：
//
//   - 第一版数钟点个数，线画在「至多 1 个」。修完再驱，模型写的是「availability runs from
//     5:00 AM to 2:00 PM，picker 里挑」—— 两个端点；再一轮写成两个时区各一遍 —— 四个端点。
//     那些都是**区间**，是在回答「你什么时候有空」，而且双时区正是 booking-slots check 4
//     要求的。个数这把尺子分不出「区间」和「清单」，只会把阈值一路往上调 —— 那就是拿数据
//     凑绿。
//   - 缺陷的真形状是**枚举**：`• 9:30 AM（就在你要的时间前）` 这样一行行列出来，而且只列
//     其中几个 —— 卡是全的、这份是截断的，读的人得自己判断哪份算数。
//
// 所以判据是：卡在的那一轮，答案里**不许有以时间开头的列表行**。区间怎么写都行。
//
//	EVAL_ROUNDS=5 make eval-slots-restated

package main

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"regexp"
	"testing"
	"time"

	"github.com/atmaxmoj/standmeet/agentcore"
)

// clockTimeRe —— 答案正文里的钟点：`9:30 AM` / `09:30` / `3 PM`。日期不算。
var clockTimeRe = regexp.MustCompile(`\b\d{1,2}:\d{2}\s*(?:[AaPp]\.?[Mm]\.?)?|\b\d{1,2}\s*[AaPp]\.?[Mm]\.?\b`)

// timeListLineRe —— 一行**以时间开头的列表项**：`- 9:30 AM …` / `• 10:00 …` / `1. 2:00 PM …`
// / `9:30 AM — 就在你要的时间前`。这正是 prod 上拍到的那个形状。
var timeListLineRe = regexp.MustCompile(
	`(?m)^\s*(?:[-*•‣]|\d+[.)])?\s*\**\d{1,2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?\**\s*(?:[-–—:(]|$)`)

// timeListMin —— 几行才算"列成了清单"。两行还能是「前一格 / 后一格」这种回答具体问题的说法，
// 三行起就是把卡里的清单又抄了一份（而且往往是截断的那一份）。
const timeListMin = 3

// TestSlotsRestatedGuardSeesTheDefect —— **判据自证**：换成"形状"之后，它还认不认得原来那个
// 缺陷？喂的是 prod 上真拍到的那两段（bullet 列表 / 数字列表），必须判到 ≥ timeListMin 行；
// 而修好之后模型写的那种"区间"必须一行都不判。判不了负的绿等于没有绿
// （[[assertion-that-cannot-fail]]）。
func TestSlotsRestatedGuardSeesTheDefect(t *testing.T) {
	t.Parallel()
	// prod（2026-08-17，bbook-26）：卡里 17 格，正文又列了四条。
	const prodBulleted = "That 10:00 AM slot is already taken, so I can't book it as-is. " +
		"Here are the closest open 30-minute slots that morning (all Eastern):\n\n" +
		"- **9:30 AM** (right before your requested time)\n" +
		"- **10:30 AM** (right after)\n" +
		"- **11:00 AM**\n" +
		"- **11:30 AM**\n\n" +
		"Want me to grab one of those?"
	// 修好之后那种：一个区间，指向 picker。
	const windowOnly = "Here you go — the available 30-minute slots for Monday, August 24 are in " +
		"the picker above. They run from 5:00 AM through 2:00 PM your time (America/Toronto). " +
		"Go ahead and pick one."
	// 两个时区各说一遍那个区间 —— 也是对的（booking-slots check 4 要求双时区）。
	const windowBothZones = "The picker above has them. Availability runs 5:00 AM–2:00 PM your " +
		"time, which is 9:00 AM–6:00 PM mine."

	if n := len(timeListLineRe.FindAllString(prodBulleted, -1)); n < timeListMin {
		t.Fatalf("SELF-TEST FAILED: the guard no longer sees the real defect (%d list lines < %d)", n, timeListMin)
	}
	for name, ok := range map[string]string{"window": windowOnly, "both zones": windowBothZones} {
		if n := len(timeListLineRe.FindAllString(ok, -1)); n >= timeListMin {
			t.Fatalf("SELF-TEST FAILED: %q (a correct answer) judged as a list (%d lines)", name, n)
		}
	}
}

func TestSlotsRestatedLive_CardIsTheList(t *testing.T) {
	loadDotenv()
	cd := resolveCredDefaults()
	if cd.Key == "" || cd.Key == "dev-llm-gateway-dummy-key" {
		t.Skip("UX-93 live eval needs a real LLM key (EVAL_KEY / provider key); skipping")
	}
	cred := agentcore.Cred{Provider: cd.Provider, Key: cd.Key, Endpoint: cd.Endpoint, Model: cd.Model}

	rounds := evalRounds()
	restated, withCard := 0, 0
	for i := range rounds {
		listed, sawCard := restatedThisRound(t, &cred, i)
		if sawCard {
			withCard++
		}
		if listed {
			restated++
		}
	}
	if withCard == 0 {
		t.Fatalf("no round produced a slots card — the guard never got to judge anything "+
			"(rounds=%d). A green here would mean nothing.", rounds)
	}
	t.Logf("UX-93 live: %d/%d rounds with a card restated the times", restated, withCard)
	if restated > 0 {
		t.Fatalf("UX-93 reproduced: %d of %d turns re-listed the slot times in prose while the "+
			"card was already showing them", restated, withCard)
	}
}

// restatedThisRound —— 一整轮真turn。返回(答案是否重列了时段, 这一轮到底有没有出卡)。
func restatedThisRound(t *testing.T, cred *agentcore.Cred, round int) (bool, bool) {
	t.Helper()
	ctx := context.Background()
	agent, _ := launchWithBookerCred(t, ctx, cred, "")

	sink := newCaptureSink()
	in := &agentcore.AgentTurnInput{
		Cred: cred,
		Req: &agentcore.AgentTurnRequest{
			System: agent.SystemPrompt, Model: cred.Model,
			ConversationID:  "c1",
			VisitorTimezone: "America/Toronto",
			UserMessage:     slotsRequest(round),
		},
		Mode: "code", Tools: agent.Tools,
		ProgressLabels: agent.Labels, ReturnDirectly: agent.ReturnDirectly,
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if rerr := agentcore.RunAgentLoop(ctx, log, in, sink); rerr != nil {
		t.Fatalf("RunAgentLoop: %v", rerr)
	}
	answer, tools, ok := sink.result()
	if !ok {
		t.Fatalf("agent errored: %s", sink.errorText())
	}
	sawCard := calledListSlots(tools)
	listLines := timeListLineRe.FindAllString(answer, -1)
	times := clockTimeRe.FindAllString(answer, -1)
	// 两个数都记：判的是 listLines（形状），times 只是读日志的人判断"这一轮到底啰不啰嗦"的旁证。
	t.Logf("round %d: tools=%d card=%v time_list_lines=%d times_mentioned=%d %v\nanswer=%s",
		round, len(tools), sawCard, len(listLines), len(times), times, answer)
	return sawCard && len(listLines) >= timeListMin, sawCard
}

// calledListSlots —— 这一轮有没有真的产出时段卡。
func calledListSlots(tools []toolUse) bool {
	for i := range tools {
		if tools[i].Name == "calendar_list_slots" {
			return true
		}
	}
	return false
}

// slotsRequest —— 访客在 prod 上问的那种问法。天数按轮次挪开，避免每轮都问同一天。
func slotsRequest(round int) string {
	day := weekdayAhead(7 + round)
	return fmt.Sprintf(
		"What 30-minute slots do you have on %s? I'm in America/Toronto.",
		day.Format("Monday January 2"))
}

var _ = time.Now
