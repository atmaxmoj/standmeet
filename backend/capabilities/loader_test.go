// loader_test.go —— 内建能力的声明拉起时真能 Load,而且**声明里不出现路径**。
//
// 这两条是这次外置的全部要点:能力说"我要哪几件事",宿主派生它够得到的那一根 socket。
// 声明里一旦又出现路径,这个机制就退回了原样(只是换了个文件格式)。

package capabilities_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/atmaxmoj/standmeet/capabilities"
	"github.com/atmaxmoj/standmeet/internal/capabilities/mcpplugin"
)

// TestLoad_DerivesTheSocketPath —— 点过 host op 的能力拿到一根**由 id 派生**的 socket;
// 一个都没点的完全断网(连环境变量都没有)。
func TestLoad_DerivesTheSocketPath(t *testing.T) {
	t.Parallel()
	ms := mustLoad(t)

	booker := mustFind(t, ms, "calendar.book")
	got := booker.Transport.Env["STANDMEET_HOST_SOCKET"]
	if want := "/run/standmeet/calendar.book.sock"; got != want {
		t.Errorf("booker socket = %q, want %q (derived from the id, not authored)", got, want)
	}

	ask := mustFind(t, ms, "ask_visitor")
	if len(ask.Transport.Sandbox.HostOps) != 0 {
		t.Fatalf("ask_visitor should order no host ops, got %v", ask.Transport.Sandbox.HostOps)
	}
	if p, ok := ask.Transport.Env["STANDMEET_HOST_SOCKET"]; ok {
		t.Errorf("ask_visitor got a host socket %q — it ordered nothing, so it reaches nothing", p)
	}
}

// TestLoad_NoPathsInTheDeclarations —— 声明里不许再出现 socket 路径。
//
// 这正是这轮改掉的东西:manifest 从前写的是"给我挂哪个文件",而一个文件名答不出"这上面有
// 什么"。宿主因此只能手写四个网关。
func TestLoad_NoPathsInTheDeclarations(t *testing.T) {
	t.Parallel()
	for _, m := range mustLoad(t) {
		for _, op := range m.Transport.Sandbox.HostOps {
			if strings.Contains(op, "/") {
				t.Errorf("%s orders %q — host ops are NAMES from a fixed vocabulary, not paths",
					m.ID, op)
			}
		}
	}
}

// TestLoad_OwnerToolSchemasAreValidJSON —— 一份编不动的 schema 会让整张 owner 工具表
// marshal 失败(历史上真发生过:一个坏 InputSchema 清空了 tools/list)。装载器当场拒。
func TestLoad_OwnerToolSchemasAreValidJSON(t *testing.T) {
	t.Parallel()
	for _, m := range mustLoad(t) {
		for i := range m.OwnerTools {
			if !json.Valid([]byte(m.OwnerTools[i].InputSchema)) {
				t.Errorf("%s owner tool %q: input_schema is not valid JSON",
					m.ID, m.OwnerTools[i].Name)
			}
		}
	}
}

// TestLoad_QuotaIsCompleteOrAbsent —— 用量声明要么三句话齐,要么没有。半份声明会让宿主
// 数不出用量,而"数不出"和"没上限"是两件事。
func TestLoad_QuotaIsCompleteOrAbsent(t *testing.T) {
	t.Parallel()
	for _, m := range mustLoad(t) {
		if m.Quota != nil && !m.Quota.Usable() {
			t.Errorf("%s has a half-written quota declaration: %+v", m.ID, m.Quota)
		}
	}
}

// TestLoad_QuotaKeyIsDeclaredOnTheCode —— 用量上限指向的那个键,必须真的是这个能力在码上
// 声明过的字段。指向一个不存在的键 = 永远读不到上限 = 悄悄不闸。
func TestLoad_QuotaKeyIsDeclaredOnTheCode(t *testing.T) {
	t.Parallel()
	for _, m := range mustLoad(t) {
		if m.Quota == nil {
			continue
		}
		if !hasField(m.CodeConfig, m.Quota.ConfigKey) {
			t.Errorf("%s quota reads %q, which it never declares in code_config",
				m.ID, m.Quota.ConfigKey)
		}
	}
}

func hasField(decl []mcpplugin.ConfigField, key string) bool {
	for i := range decl {
		if decl[i].Key == key {
			return true
		}
	}
	return false
}

func mustLoad(t *testing.T) []mcpplugin.Manifest {
	t.Helper()
	ms, err := capabilities.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if len(ms) == 0 {
		t.Fatal("Load returned no built-in capabilities")
	}
	return ms
}

func mustFind(t *testing.T, ms []mcpplugin.Manifest, id string) *mcpplugin.Manifest {
	t.Helper()
	for i := range ms {
		if ms[i].ID == id {
			return &ms[i]
		}
	}
	t.Fatalf("built-in capability %q not found", id)
	return nil
}
