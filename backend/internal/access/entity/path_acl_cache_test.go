package entity

import "testing"

// TestCompileGlobCached —— 同 pattern 两次返回同一个编译好的 regex 实例(证明缓存生效,
// 热路径不重编)。行为正确性由 corpus ACL 的 e2e/其它 domain 测试守。
func TestCompileGlobCached(t *testing.T) {
	a := compileGlob("wiki://projects/**")
	b := compileGlob("wiki://projects/**")
	if a != b {
		t.Fatal("compileGlob not cached: got two distinct instances")
	}
	// 缓存不影响匹配语义。
	if !a.MatchString("wiki://projects/lucerna") {
		t.Fatal("cached glob failed to match expected uri")
	}
	if a.MatchString("wiki://personal/family") {
		t.Fatal("cached glob matched an out-of-scope uri")
	}
}
