// role_dock_buttons_test.go —— #109/#110 dock 按钮的 domain 不变量：
//   - 一个 role 最多两个 dock 按钮（chat 两个位）
//   - 每个按钮的触发词非空（点了没触发词的按钮没意义）
//   - entity.RoleSnapshot 冻下 dock 按钮配置（session 起那刻拍死，owner 后改不影响在跑 session）
// title 解析 + code-deny 过滤在会话装配层，不在这（domain 只管纯配置不变量）。

package entity_test

import (
	"testing"

	"github.com/atmaxmoj/standmeet/internal/access/entity"
)

func TestValidateDockButtons_AcceptsUpToTwo(t *testing.T) {
	t.Parallel()
	err := entity.ValidateDockButtons([]entity.DockButtonConfig{
		{CapabilityID: "summarize_conversation", Trigger: "Summarize this"},
		{CapabilityID: "corpus.retrieval", Trigger: "What have we covered?"},
	})
	if err != nil {
		t.Fatalf("two dock buttons must be accepted, got %v", err)
	}
}

func TestValidateDockButtons_RejectsMoreThanTwo(t *testing.T) {
	t.Parallel()
	err := entity.ValidateDockButtons([]entity.DockButtonConfig{
		{CapabilityID: "a", Trigger: "1"},
		{CapabilityID: "b", Trigger: "2"},
		{CapabilityID: "c", Trigger: "3"},
	})
	if err == nil {
		t.Fatal("more than two dock buttons must be rejected")
	}
}

func TestValidateDockButtons_RejectsEmptyTrigger(t *testing.T) {
	t.Parallel()
	err := entity.ValidateDockButtons([]entity.DockButtonConfig{
		{CapabilityID: "summarize_conversation", Trigger: "   "},
	})
	if err == nil {
		t.Fatal("a dock button with a blank trigger must be rejected")
	}
}

func TestValidateDockButtons_EmptyIsFine(t *testing.T) {
	t.Parallel()
	if err := entity.ValidateDockButtons(nil); err != nil {
		t.Fatalf("no dock buttons is valid, got %v", err)
	}
}

func TestRoleSnapshot_FreezesDockButtons(t *testing.T) {
	t.Parallel()
	cfg := []entity.DockButtonConfig{
		{CapabilityID: "summarize_conversation", Trigger: "Summarize this"},
	}
	snap := entity.NewRoleSnapshot(&entity.RoleSnapshotInit{
		RoleID: "r1", DockButtons: cfg,
	})
	got := snap.DockButtons()
	if len(got) != 1 {
		t.Fatalf("frozen dock buttons len = %d, want 1", len(got))
	}
	if got[0].CapabilityID != "summarize_conversation" || got[0].Trigger != "Summarize this" {
		t.Fatalf("frozen dock button mismatch: %+v", got[0])
	}
	// defensive clone: mutating the source must not touch the frozen snapshot.
	cfg[0].Trigger = "mutated"
	if snap.DockButtons()[0].Trigger != "Summarize this" {
		t.Fatal("entity.RoleSnapshot must defensively clone dock buttons")
	}
}
