package main

import (
	"strings"
	"testing"
)

// TestSearchAndGrepPromiseDifferentThings —— 这两句描述是**功能本身**。
//
// agent 是靠读它们来选的。一旦有人把其中一句改得像另一句(比如给 grep 也加上 "search the
// corpus by keyword"),agent 就只能瞎选:该要确定性的时候用了排序检索,答案里少了东西,而且
// 没有任何一个测试会红 —— 两个工具都"能跑"。
//
// 所以这里钉的不是措辞,是**保证的差异**:一句必须说排序/容错,另一句必须说穷尽/精确。
func TestSearchAndGrepPromiseDifferentThings(t *testing.T) {
	t.Parallel()
	search := strings.ToLower(searchTool().Description)
	grep := strings.ToLower(grepTool().Description)

	if search == grep {
		t.Fatal("the two descriptions are identical — the agent cannot choose")
	}
	// grep 那句必须说清它的保证:穷尽 + 精确。
	for _, want := range []string{"every place", "exhaustive", "exact"} {
		if !strings.Contains(grep, want) {
			t.Fatalf("corpus_grep's description no longer says %q — "+
				"never-miss is only reachable if the description states it", want)
		}
	}
	// 而 search 那句必须说清它是关键词检索(不许改成"精确/穷尽"那一套)。
	if !strings.Contains(search, "keyword") {
		t.Fatal("corpus_search's description no longer says it is a keyword search")
	}
	for _, forbidden := range []string{"every place", "exhaustive"} {
		if strings.Contains(search, forbidden) {
			t.Fatalf("corpus_search's description now claims %q — "+
				"it is a ranked index and cannot promise that", forbidden)
		}
	}
}

// TestGrepToolShape —— 参数名跟宿主那侧解的字段对得上(pattern / fixed / case_sensitive)。
// 名字对不上不会报错,只会永远走默认值 —— fixed 传了却不生效那种。
func TestGrepToolShape(t *testing.T) {
	t.Parallel()
	schema := string(grepTool().RawInputSchema)
	for _, field := range []string{`"pattern"`, `"fixed"`, `"case_sensitive"`} {
		if !strings.Contains(schema, field) {
			t.Fatalf("corpus_grep schema is missing %s", field)
		}
	}
}
