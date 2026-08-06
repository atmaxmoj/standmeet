// corpus_grep_test.go —— never-miss 是一条**性质**,所以按性质测,不按例子测。
//
// 一个手挑的例子("subsystem 找得到")什么也证明不了:它只说明那一个字符串在那一条正文里
// 被找到了。这里生成一批正文,再从其中任意一条里抠出任意一段,断言它一定被找到 —— 覆盖的是
// "在的一定找得到"这句话本身。第二阶段换成稀疏索引之后,这个测试一个字不用改:候选集怎么来
// 不归它管,它管的是判定不许漏。

package usecase

import (
	"math/rand"
	"strings"
	"testing"
)

const (
	// grepSeed —— 固定种子。随机是为了覆盖面,不是为了每次不一样;一个偶尔红的测试没人信。
	grepSeed      = 20260806
	grepFragSeed  = 1
	generatedN    = 200
	maxLinesPer   = 6
	maxWordsPer   = 8
	minFragRunes  = 4
	maxFragRunes  = 40
	repeatedLines = 20
)

// grepWords —— 生成语料的词表。中文两个字的词特意在里面:分词器切不出来的东西正是这条路
// 存在的理由,而 GrepBody 对它必须跟对 ASCII 一样有效。
//
//nolint:gosmopolitan // 中文词就是被测对象本身,换成 ASCII 等于不测那一半
var grepWords = []string{
	"cybernetics", "ashby", "requisite", "variety", "homeostat", "feedback",
	"控制论", "反馈回路", "自组织", "SM-4471/b", "C++", "a.b.c", "naive",
}

// generatedBodies —— 一批像正文的字符串。
func generatedBodies(seed int64, n int) []string {
	r := rand.New(rand.NewSource(seed)) //nolint:gosec // 测试语料,不是密码学用途
	out := make([]string, 0, n)
	for range n {
		out = append(out, oneBody(r))
	}
	return out
}

func oneBody(r *rand.Rand) string {
	var b strings.Builder
	for range 1 + r.Intn(maxLinesPer) {
		for range 1 + r.Intn(maxWordsPer) {
			b.WriteString(grepWords[r.Intn(len(grepWords))])
			b.WriteByte(' ')
		}
		b.WriteByte('\n')
	}
	return b.String()
}

// TestGrepNeverMisses —— 任取一条正文里的任意一段,grep 一定在那条正文里找到它。
func TestGrepNeverMisses(t *testing.T) {
	t.Parallel()
	bodies := generatedBodies(grepSeed, generatedN)
	r := rand.New(rand.NewSource(grepFragSeed)) //nolint:gosec // 同上
	for i := range bodies {
		fragment, ok := pickFragment(r, bodies[i])
		if !ok {
			continue
		}
		re, err := CompileGrep(&GrepRequest{Pattern: fragment, Fixed: true})
		if err != nil {
			t.Fatalf("compile %q: %v", fragment, err)
		}
		if _, total := GrepBody(re, bodies[i]); total == 0 {
			t.Fatalf("fragment %q is in body %d but grep missed it", fragment, i)
		}
	}
}

// pickFragment —— 正文里随机一段,单行(跨行的片段本来就不在任何一行里,判定按行做)。
func pickFragment(r *rand.Rand, body string) (string, bool) {
	runes := []rune(body)
	if len(runes) < minFragRunes {
		return "", false
	}
	start := r.Intn(len(runes) - minFragRunes + 1)
	end := start + 1 + r.Intn(min(len(runes)-start, maxFragRunes))
	frag := string(runes[start:end])
	if strings.TrimSpace(frag) == "" || strings.Contains(frag, "\n") {
		return "", false
	}
	return frag, true
}

// TestGrepFixedQuotesMetacharacters —— fixed 模式下 "C++" / "a.b.c" 当字面量。
// 不加这一条,那两个字符串会被当成正则:"C++" 直接编译不过,"a.b.c" 会匹配到不该匹配的地方。
func TestGrepFixedQuotesMetacharacters(t *testing.T) {
	t.Parallel()
	re, err := CompileGrep(&GrepRequest{Pattern: "a.b.c", Fixed: true})
	if err != nil {
		t.Fatalf("compile fixed: %v", err)
	}
	if _, total := GrepBody(re, "axbxc is not a.b.c"); total != 1 {
		t.Fatalf("fixed pattern matched the regex way (total=%d)", total)
	}
	if _, cerr := CompileGrep(&GrepRequest{Pattern: "C++", Fixed: true}); cerr != nil {
		t.Fatalf("C++ must be searchable as a literal: %v", cerr)
	}
}

// TestGrepBadPatternIsAnInputError —— 编译不了 → ErrGrepPattern(面翻成人话),不是 panic
// 也不是"没找到"。悄悄返回空集是最坏的那种:agent 会当成"语料里没有"。
func TestGrepBadPatternIsAnInputError(t *testing.T) {
	t.Parallel()
	for _, pat := range []string{"unclosed(", "[a-", "*"} {
		if _, err := CompileGrep(&GrepRequest{Pattern: pat}); err == nil {
			t.Fatalf("pattern %q compiled — a broken pattern must be reported", pat)
		}
	}
	if _, err := CompileGrep(&GrepRequest{Pattern: "   "}); err == nil {
		t.Fatal("an empty pattern must be reported, not matched against everything")
	}
}

// TestGrepCountsAndCaps —— 命中总数照实报,但一条笔记里最多回几行。两件事不能混:
// 截断的是**行**,不是命中的笔记 —— 后者一旦截断,never-miss 就没了。
func TestGrepCountsAndCaps(t *testing.T) {
	t.Parallel()
	body := strings.Repeat("needle here\n", repeatedLines)
	re, err := CompileGrep(&GrepRequest{Pattern: "needle", Fixed: true})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	lines, total := GrepBody(re, body)
	if total != repeatedLines {
		t.Fatalf("total = %d, want %d (the count must not be capped)", total, repeatedLines)
	}
	if len(lines) != grepMaxLinesPerNote {
		t.Fatalf("lines = %d, want %d", len(lines), grepMaxLinesPerNote)
	}
}

// TestGrepCaseInsensitiveByDefault —— 默认不分大小写(agent 拿到的多半是人说的词),
// 显式要求时才分。
func TestGrepCaseInsensitiveByDefault(t *testing.T) {
	t.Parallel()
	loose, err := CompileGrep(&GrepRequest{Pattern: "Ashby", Fixed: true})
	if err != nil {
		t.Fatalf("compile: %v", err)
	}
	if _, total := GrepBody(loose, "ashby wrote"); total != 1 {
		t.Fatal("default matching must ignore case")
	}
	strict, serr := CompileGrep(&GrepRequest{Pattern: "Ashby", Fixed: true, CaseSensitive: true})
	if serr != nil {
		t.Fatalf("compile: %v", serr)
	}
	if _, total := GrepBody(strict, "ashby wrote"); total != 0 {
		t.Fatal("case_sensitive must be honoured")
	}
}
