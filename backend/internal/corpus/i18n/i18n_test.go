// i18n_test.go —— 容错表一行一条,外加解析器那两个学费换来的陷阱。
//
// 这些规则是**文本的纯函数**,所以它们在这里被穷尽地覆盖;e2e 那边只验四个消费方确实
// 接到了这个函数、并且把结果露出来了 —— 十八个浏览器往返去测一张字符串矩阵没有意义。
//

package i18n

import (
	"strings"
	"testing"
)

const (
	langEN = "en"
	langZH = "zh"
)

//nolint:gosmopolitan // 中文样本就是被测对象:多语笔记的另一面本来就是中文
const twoPanes = `> [!i18n]
> > [!lang] en
> > # Title
> > English prose.
>
> > [!lang] zh
> > # 标题
> > 中文正文。
`

func codesOf(ds []Diagnostic) []string {
	out := make([]string, 0, len(ds))
	for i := range ds {
		out = append(out, ds[i].Code)
	}
	return out
}

func hasCode(ds []Diagnostic, code string) bool {
	for i := range ds {
		if ds[i].Code == code {
			return true
		}
	}
	return false
}

// TestMinimumFormNeedsNoFrontmatter —— 契约就是嵌套 callout;frontmatter 一个字都不写也成立。
func TestMinimumFormNeedsNoFrontmatter(t *testing.T) {
	t.Parallel()
	doc := Parse(twoPanes)
	if len(doc.Langs) != 2 || doc.Langs[0] != langEN || doc.Langs[1] != langZH {
		t.Fatalf("langs inferred from panes = %v, want [en zh]", doc.Langs)
	}
	if ds := Validate(nil, twoPanes); len(ds) != 0 {
		t.Fatalf("the minimum form must be clean, got %v", codesOf(ds))
	}
}

// TestMonolingualNoteIsSilent —— 绝大多数笔记没有多语区块,校验在那儿一个字都不该说。
func TestMonolingualNoteIsSilent(t *testing.T) {
	t.Parallel()
	body := "# Just a note\n\nOne language, no blocks.\n"
	if ds := Validate(&Frontmatter{Lang: langEN}, body); len(ds) != 0 {
		t.Fatalf("a monolingual note must produce no diagnostics, got %v", codesOf(ds))
	}
	if d := Parse(body); d.Multilingual() {
		t.Fatal("a note without an i18n block is not multilingual")
	}
}

// TestNeutralProseSurvivesBothLanguages —— 最要紧的一条:区块外的散文是语言中性的,
// 两种语言下都在。它是"一条笔记 ≠ N 份文档"这句话的全部内容 —— N 份文档的实现会把它复制两遍,
// 而这条测试是唯一分得出两者的。
//
//nolint:gosmopolitan,cyclop // 同上:中文那一面是断言对象;分支是 2 语言 × 2 断言
func TestNeutralProseSurvivesBothLanguages(t *testing.T) {
	t.Parallel()
	body := "Intro prose.\n\n" + twoPanes + "\nOutro prose.\n"
	doc := Parse(body)
	for _, lang := range []string{langEN, langZH} {
		out := Render(&doc, lang, langEN)
		if !strings.Contains(out, "Intro prose.") || !strings.Contains(out, "Outro prose.") {
			t.Fatalf("neutral prose missing under %q:\n%s", lang, out)
		}
	}
	en := Render(&doc, langEN, langEN)
	if strings.Contains(en, "中文正文") {
		t.Fatal("the other language's prose must not be in the en render at all")
	}
	if !strings.Contains(Render(&doc, langZH, langEN), "中文正文") {
		t.Fatal("zh render must carry the zh pane")
	}
}

// TestSeveralRegionsInOneNote —— 一条笔记里多个区块,中间夹着中性散文(真实样本的形状)。
func TestSeveralRegionsInOneNote(t *testing.T) {
	t.Parallel()
	body := twoPanes + "\nBetween the regions.\n\n" + twoPanes
	doc := Parse(body)
	regions := 0
	for i := range doc.Regions {
		if len(doc.Regions[i].Panes) > 0 {
			regions++
		}
	}
	if regions != 2 {
		t.Fatalf("regions = %d, want 2", regions)
	}
	if !strings.Contains(Render(&doc, langZH, langEN), "Between the regions.") {
		t.Fatal("prose between two regions is neutral and must be kept")
	}
}

// TestButtonRowIsDropped —— Obsidian 的那排单选按钮是呈现件,不是内容:一个字符都不该出去
// (既不当控件,也不当文字)。
//
//nolint:gosmopolitan // 按钮行里的中文标签是原样样本
func TestButtonRowIsDropped(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n" +
		"> <label><input type=\"radio\" name=\"x\" checked>EN</label><label>中文</label>\n" +
		">\n> > [!lang] en\n> > Body.\n"
	out := Render(doc(body), langEN, langEN)
	for _, leak := range []string{"<label", "<input", "radio", "checked"} {
		if strings.Contains(out, leak) {
			t.Fatalf("button-row markup leaked (%q) into:\n%s", leak, out)
		}
	}
}

// TestFenceHidesAMarker —— 围栏代码块里的 `[!i18n]` 不是区块(tikz / 教程里就长这样)。
func TestFenceHidesAMarker(t *testing.T) {
	t.Parallel()
	body := "Example:\n\n```markdown\n> [!i18n]\n> > [!lang] en\n> > x\n```\n\nDone.\n"
	if d := Parse(body); d.Multilingual() {
		t.Fatal("a marker inside a fenced block must not make the note multilingual")
	}
	if ds := Validate(nil, body); len(ds) != 0 {
		t.Fatalf("nothing to diagnose inside a code fence, got %v", codesOf(ds))
	}
}

// TestNestedCalloutInsideAPaneStaysInside —— pane 里可以再套 callout(模板里就有
// i18n > lang > tip)。深度 3 的东西不是新的 pane。
func TestNestedCalloutInsideAPaneStaysInside(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > # T\n> > > [!tip] Note\n> > > inner\n"
	doc := Parse(body)
	if len(doc.Langs) != 1 {
		t.Fatalf("langs = %v, want exactly [en]", doc.Langs)
	}
	out := Render(&doc, langEN, langEN)
	if !strings.Contains(out, "> [!tip] Note") {
		t.Fatalf("the nested callout must survive inside the pane:\n%s", out)
	}
}

// —— 容错表 ——

func TestLangsDisagreeingWithPanesTrustsThePanes(t *testing.T) {
	t.Parallel()
	fm := &Frontmatter{Lang: langEN, Langs: []string{langEN, langZH, "ja"}}
	ds := Validate(fm, twoPanes)
	if !hasCode(ds, CodeLangsMismatch) {
		t.Fatalf("a mismatch must be reported, got %v", codesOf(ds))
	}
	doc := Parse(twoPanes)
	if got := Resolve(&doc, "ja", langEN); got != langEN {
		t.Fatalf("a declared-but-absent language must fall back to lang, got %q", got)
	}
}

func TestDuplicatePaneKeepsTheFirst(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > first\n>\n> > [!lang] en\n> > second\n"
	ds := Validate(nil, body)
	if !hasCode(ds, CodeDuplicatePane) {
		t.Fatalf("a duplicate pane must warn, got %v", codesOf(ds))
	}
	if HasError(ds) {
		t.Fatal("a duplicate is a warning — the note still renders")
	}
	if out := Render(doc(body), langEN, langEN); !strings.Contains(out, "first") {
		t.Fatalf("the first pane wins, got:\n%s", out)
	}
}

func TestSinglePaneRendersMonolingual(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > only one\n"
	doc := Parse(body)
	if len(doc.Langs) != 1 {
		t.Fatalf("langs = %v", doc.Langs)
	}
	if HasError(Validate(nil, body)) {
		t.Fatal("one pane is a legitimate note, not an error")
	}
}

func TestOrphanPaneWarnsAndDoesNotCrash(t *testing.T) {
	t.Parallel()
	body := "> [!lang] en\n> stray pane\n"
	ds := Validate(nil, body)
	if !hasCode(ds, CodeOrphanLangPane) {
		t.Fatalf("an orphan pane must warn, got %v", codesOf(ds))
	}
	if HasError(ds) {
		t.Fatal("an orphan pane renders as a plain callout — that is not an error")
	}
}

func TestUnknownCodeIsRenderedNotRejected(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > hello\n>\n> > [!lang] fr-CA\n> > bonjour\n"
	if HasError(Validate(nil, body)) {
		t.Fatal("an unrecognised code is still a code — we do not police the list")
	}
	if out := Render(doc(body), "fr-ca", langEN); !strings.Contains(out, "bonjour") {
		t.Fatalf("fr-CA must render, got:\n%s", out)
	}
}

func TestEmptyPaneIsAnError(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] en\n> > body\n>\n> > [!lang] zh\n"
	ds := Validate(nil, body)
	if !hasCode(ds, CodeEmptyPane) || !HasError(ds) {
		t.Fatalf("an empty pane must be an error, got %v", codesOf(ds))
	}
}

func TestLangsWithoutABlockIsAnError(t *testing.T) {
	t.Parallel()
	fm := &Frontmatter{Lang: langEN, Langs: []string{langEN, langZH}}
	ds := Validate(fm, "# Plain\n\nNo blocks here.\n")
	if !hasCode(ds, CodeLangsWithoutBlock) || !HasError(ds) {
		t.Fatalf("declaring langs with no block must be an error, got %v", codesOf(ds))
	}
}

func TestLangMustHaveAPane(t *testing.T) {
	t.Parallel()
	fm := &Frontmatter{Lang: "de", Langs: []string{langEN, langZH}}
	ds := Validate(fm, twoPanes)
	if !hasCode(ds, CodeLangNotInLangs) {
		t.Fatalf("the fallback language must exist, got %v", codesOf(ds))
	}
}

// —— 选择与标签 ——

//nolint:gosmopolitan // 中文那一面是样本本身
func TestResolveFallsBackToLangNotToLangsZero(t *testing.T) {
	t.Parallel()
	body := "> [!i18n]\n> > [!lang] zh\n> > 中文\n>\n> > [!lang] en\n> > English\n"
	doc := Parse(body)
	// panes 的顺序是 zh, en;身份语言是 en。要一个不存在的语言 → 落到 en,不是 zh。
	if got := Resolve(&doc, "de", langEN); got != langEN {
		t.Fatalf("fallback = %q, want the identity language en", got)
	}
	// 连身份语言都没写 → 才轮到第一面。
	if got := Resolve(&doc, "de", ""); got != langZH {
		t.Fatalf("with no identity language the first pane wins, got %q", got)
	}
}

//nolint:gosmopolitan // 标签规则测的就是中文写法
func TestLabelUsesVaultRuleThenBuiltinThenUppercase(t *testing.T) {
	t.Parallel()
	if got := Label(langZH, map[string]string{langZH: "简体中文"}); got != "简体中文" {
		t.Fatalf("lang-labels must win, got %q", got)
	}
	if got := Label(langZH, nil); got != "中文" {
		t.Fatalf("non-Latin scripts get their own name, got %q", got)
	}
	if got := Label("fr", nil); got != "FR" {
		t.Fatalf("plain codes uppercase, got %q", got)
	}
}

// doc —— 少写一次 Parse;取地址是因为 Render/Resolve 收指针。
func doc(body string) *Doc { d := Parse(body); return &d }
