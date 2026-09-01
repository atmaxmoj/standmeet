// deps_wired_test.go —— AssertDepsWired 的自证。
//
// 跟 infra/scripts 里每个闸门的 `--self-test` 同一个约定：**一个从不报红的检查等于没有**。
// 这里种的不是随便一个空结构体，而是 2026-08-31 真实漏掉的那一条 ——
// `buildAdminHandlers` 少抄了 `EmailChange:` 那一行，于是 owner 点确认链接时空指针 panic，
// 而 UI 把它显示成"这个链接无效"。

package admin_test

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/internal/infra/depcheck"
	owner "github.com/atmaxmoj/standmeet/internal/owner/facade"
	"github.com/atmaxmoj/standmeet/internal/routes/admin"
)

// stubSender —— 只为把一个非 nil 值放进 Proxy 位；方法体不会被调用。
// 用 Proxy 而不是 Owners：Owners 是具体的 *repo.Repo，而路由层不许 import repo
// （域的 guts 只经 facade 出来）—— 造一个真的 Repo 会为了测试捅穿那道边界。
type stubSender struct{}

func (stubSender) Connected(context.Context, string) (bool, error)          { return false, nil }
func (stubSender) Send(context.Context, string, owner.OutboundNotice) error { return nil }
func (stubSender) ChannelName() string                                      { return "stub" }

func TestAssertDepsWiredFlagsTheLineThatWasActuallyMissed(t *testing.T) {
	t.Parallel()
	// 漏抄的样子，用**真实那个类型**：这一组 dep 一个成员都没赋值。
	if !depcheck.AllNilMembers(reflect.ValueOf(owner.EmailChangeDeps{})) {
		t.Fatal("EmailChange with nothing wired was reported as wired — " +
			"that is exactly the shape of the line that was missed")
	}
	// 接上之后就不该再报，否则这条检查会拦住正常启动。
	// 只要有一个成员非 nil，就是有人赋过值。
	if depcheck.AllNilMembers(reflect.ValueOf(owner.EmailChangeDeps{Proxy: stubSender{}})) {
		t.Fatal("a wired dep group was reported as unwired — this check would block a good boot")
	}
}

func TestAssertDepsWiredNamesTheField(t *testing.T) {
	t.Parallel()
	err := (&admin.Handlers{}).AssertDepsWired()
	if err == nil {
		t.Fatal("nothing was wired at all, and the check said it was fine")
	}
	// 报错必须说出**是哪一组** —— 否则读到的人还得自己去比对整张字段表。
	if !strings.Contains(err.Error(), "EmailChange") {
		t.Fatalf("the error does not name EmailChange, so nobody can act on it: %v", err)
	}
}
