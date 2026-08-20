// pertool_requires_test.go —— F-B-8：`visitor_tools` 的两种写法都要收，而且**两种都要有对象**。
//
// 这里守的不是"能解析"，是**粒度**：只读授权下该消失的是订会那几个动作，
// 而「列时段」必须留着 —— 那件事在只读下本来就是好的，藏掉它等于为了修一个缺陷造出另一个。

package capabilities_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

const (
	insertScope = "calendar:events.insert"
	deleteScope = "calendar:events.delete"
	// bookerVisitorTools —— booker 摆给访客的工具数。写死是有意的：这个数字变了，
	// 说明有人加了或删了一个访客能按的动作，那件事应当有人看一眼。
	bookerVisitorTools = 7
)

func TestBothSpellingsParse(t *testing.T) {
	t.Parallel()
	// 混写（裸名字 + 映射）不能让任何一条掉队。
	if got := loadBooker(t).VisitorTools; len(got) != bookerVisitorTools {
		t.Fatalf("visitor tool names = %v, want all %d", got, bookerVisitorTools)
	}
}

func TestWriteToolsNameTheActionTheyNeed(t *testing.T) {
	t.Parallel()
	reqs := loadBooker(t).VisitorToolRequires
	for tool, want := range map[string]string{
		"calendar_book":           insertScope,
		"calendar_cancel":         deleteScope,
		"calendar_cancel_booking": deleteScope,
	} {
		if got := reqs[tool]; len(got) != 1 || got[0] != want {
			t.Errorf("%s requires = %v, want [%s]", tool, got, want)
		}
	}
}

func TestReschedulingNeedsBothActions(t *testing.T) {
	t.Parallel()
	// 改期 = 先删旧的再插新的。
	if got := loadBooker(t).VisitorToolRequires["calendar_reschedule"]; len(got) != 2 {
		t.Errorf("calendar_reschedule requires = %v, want both insert and delete", got)
	}
}

// ★ 这一条是这个文件真正的理由：**读操作不许被牵连**。
// 它们没有额外要求，所以只读授权下必须还在 —— 一起藏掉就是拿掉一个做得到的动作。
func TestReadToolsCarryNoExtraRequirement(t *testing.T) {
	t.Parallel()
	reqs := loadBooker(t).VisitorToolRequires
	for _, tool := range []string{"calendar_list_slots", "bookings_list"} {
		if got, ok := reqs[tool]; ok {
			t.Errorf("%s is a read; it must carry no extra requirement, got %v", tool, got)
		}
	}
}

func loadBooker(t *testing.T) mcpplugin.Manifest {
	t.Helper()
	ms, err := capabilities.Load()
	if err != nil {
		t.Fatalf("load builtin capabilities: %v", err)
	}
	for i := range ms {
		if ms[i].ID == "calendar.book" {
			return ms[i]
		}
	}
	t.Fatal("calendar.book not among the builtin capabilities")
	return mcpplugin.Manifest{}
}
