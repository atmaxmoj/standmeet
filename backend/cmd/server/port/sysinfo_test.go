package port

import (
	"errors"
	"testing"
)

// TestPingCheck —— health.OK 真实反映 ping 结果,不是硬编 true。这正是之前 e2e 证不了的点
// (e2e 里依赖恒在 → ok===true 跟硬编 true 不可区分;杀共享 db 又太破坏)。纯函数单测直接钉死:
// nil err → OK true;非 nil err(ping 失败)→ OK false。db.Ping 是 err 来源(见 healthChecks)。
func TestPingCheck(t *testing.T) {
	up := pingCheck("database", "postgres", nil)
	if !up.OK {
		t.Fatal("nil error (dependency up) must be OK=true, got false")
	}
	if up.Name != "database" || up.Detail != "postgres" {
		t.Fatalf("pingCheck dropped name/detail: %+v", up)
	}
	down := pingCheck("database", "postgres", errors.New("connection refused"))
	if down.OK {
		t.Fatal("non-nil error (ping failed) must be OK=false, got true — OK is NOT hardcoded")
	}
}
