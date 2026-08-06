// agent_instruction_datetime_test.go —— 通用 instruction 里**不许出现任何一个能力的名字**。
//
// 内核拼的这段是"现在几点、owner 在哪个时区、访客在哪个时区" —— 每一轮都拼,跟访客被授了什么
// 能力无关。它却一直写着"the owner's **calendar** runs in this timezone"和"before proposing or
// **scheduling** times":一个没被授予预约能力的访客,他的 system prompt 里照样躺着一句关于日程的
// 指示。check-core-agnostic 的基线上最后那一条就是它
// (conversation/inference/agent_instruction.go<TAB>calendar)。
//
// 时区上下文本身是通用的(简历、经历、"最近"都要锚今天),该搬走的是**那句指示**:怎么换算、
// 什么时候反问、要不要双显 —— 那是会排期的那个能力自己的事,由它在自己的 instructions 里说。
//
// 下面两组断言是一对,缺一不可:
//   - 说了该说的(日期、owner 时区、把"今天"锚住、访客时区是个事实)
//   - 没说不该说的(任何具体能力的词)
// 只有后者的话,把整段删掉也能绿 —— 那是一条自己给自己放水的测试。

package inference

import (
	"strings"
	"testing"
	"time"
)

const (
	dtPersona = "You are the owner's voice."
	ownerTZ   = "America/Toronto"
	dtYear    = 2026
	dtDay     = 5
	dtHour    = 14
	dtMinute  = 30
)

// dtNow —— 固定的"现在"。日期本身不重要,重要的是它必须原样出现在那段上下文里
// (下面断言的 "2026-08-05" 就是它)。
func dtNow() time.Time {
	return time.Date(dtYear, time.August, dtDay, dtHour, dtMinute, 0, 0, time.UTC)
}

// 具体能力的词。内核这一段一个都不该出现 —— 它不知道访客被授了什么。
var capabilityWords = []string{
	"calendar", "schedul", "booking", "book a", "meeting", "appointment",
}

func TestInstructionWithDateTime_NamesNoCapability(t *testing.T) {
	t.Parallel()
	now := dtNow()
	for _, visitorTZ := range []string{"", "Europe/Berlin", ownerTZ} {
		got := instructionWithDateTime(dtPersona, now, ownerTZ, visitorTZ)
		lower := strings.ToLower(got)
		for _, w := range capabilityWords {
			if strings.Contains(lower, w) {
				t.Errorf("visitor_tz=%q: the always-on datetime context names a capability (%q). "+
					"A visitor who was never granted booking still carries this in their "+
					"system prompt; how to convert and when to ask belongs to the capability "+
					"that schedules.\n--- instruction ---\n%s", visitorTZ, w, got)
			}
		}
	}
}

// 该说的还得说 —— 否则"不含 calendar"靠删光整段也能满足。
func TestInstructionWithDateTime_StillAnchorsNow(t *testing.T) {
	t.Parallel()
	got := instructionWithDateTime(dtPersona, dtNow(), ownerTZ, "")

	for _, want := range []string{
		dtPersona,          // 原 persona 不能被吃掉
		"2026-08-05",       // 今天是哪天
		ownerTZ,            // owner 的时区
		"nearest upcoming", // 无年份的日期锚到将来,不是训练期的某个过去年份
	} {
		if !strings.Contains(got, want) {
			t.Errorf("datetime context lost %q:\n%s", want, got)
		}
	}
}

// 访客时区是**事实**,不是指示:知道就说一句,不知道就不说(要不要因此反问,由会排期的能力决定)。
func TestVisitorTZClause_StatesAFactOrNothing(t *testing.T) {
	t.Parallel()
	if got := visitorTZClause("", ownerTZ); got != "" {
		t.Errorf("unknown visitor timezone should add nothing to the generic context, got %q", got)
	}
	same := visitorTZClause(ownerTZ, ownerTZ)
	if !strings.Contains(same, "same timezone") {
		t.Errorf("same-timezone visitor should be stated plainly, got %q", same)
	}
	diff := visitorTZClause("Europe/Berlin", ownerTZ)
	if !strings.Contains(diff, "Europe/Berlin") {
		t.Errorf("known visitor timezone must be stated, got %q", diff)
	}
}
