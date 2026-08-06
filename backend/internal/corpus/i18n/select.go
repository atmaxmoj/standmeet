// select.go —— "这位读者应该看到哪一份正文"。
//
// 一条笔记**不是** N 份文档,所以选语言不是选文档:中性散文照出,多语区块换成那一面。
// 这条规则同时供三处:读者页、检索(一条命中而不是 N 条)、以及喂给 agent 的上下文
// (一次一种语言,不是把 N 种都灌进去)。

package i18n

import "strings"

// Render —— 按 want 语言把正文拼回一份单语 markdown。
//
// want 为空、或者这条笔记里根本没有那一面 → 退回 fallback(frontmatter 的 lang);
// 连 fallback 都没有 → 第一面。**绝不把某一面贴到另一个语言标签下**:退回整条,
// 而不是猜一段。
func Render(doc *Doc, want, fallback string) string {
	if !doc.Multilingual() {
		return joinNeutral(doc)
	}
	pick := Resolve(doc, want, fallback)
	parts := make([]string, 0, len(doc.Regions))
	for i := range doc.Regions {
		if part := regionText(&doc.Regions[i], pick); part != "" {
			parts = append(parts, part)
		}
	}
	return strings.Join(parts, "\n\n")
}

// Resolve —— 实际会用哪个语言码。
//
// 顺序:读者要的 → 身份语言(lang)→ 第一面。`?lang=de` 落在一条没有德语的笔记上时,
// 落点是 lang 而**不是** langs[0] —— lang 是这条笔记的身份,langs[0] 只是碰巧排在前面。
func Resolve(doc *Doc, want, fallback string) string {
	if code := strings.ToLower(strings.TrimSpace(want)); contains(doc.Langs, code) {
		return code
	}
	if code := strings.ToLower(strings.TrimSpace(fallback)); contains(doc.Langs, code) {
		return code
	}
	if len(doc.Langs) > 0 {
		return doc.Langs[0]
	}
	return ""
}

// regionText —— 一段在选定语言下的样子:中性段原样,多语段取那一面(没有那一面 → 空)。
func regionText(r *Region, lang string) string {
	if len(r.Panes) == 0 {
		return r.Neutral
	}
	for i := range r.Panes {
		if r.Panes[i].Lang == lang {
			return r.Panes[i].Body
		}
	}
	return ""
}

func joinNeutral(doc *Doc) string {
	parts := make([]string, 0, len(doc.Regions))
	for i := range doc.Regions {
		if doc.Regions[i].Neutral != "" {
			parts = append(parts, doc.Regions[i].Neutral)
		}
	}
	return strings.Join(parts, "\n\n")
}

// Label —— 切换器上这个语言码显示成什么。
//
// 规则来自 vault 自己的 lang-labels:owner 写了就用他的;没写就按码给一个 ——
// 非拉丁文字给本地写法(zh→中文),其余大写(fr→FR)。不发明第二套规则。
func Label(code string, labels map[string]string) string {
	if l, ok := labels[code]; ok && strings.TrimSpace(l) != "" {
		return l
	}
	if l, ok := builtinLabels[strings.ToLower(code)]; ok {
		return l
	}
	return strings.ToUpper(code)
}

// builtinLabels —— 非拉丁文字的默认写法:一个中文读者看到 "ZH" 会以为那是别人的语言。
//
//nolint:gosmopolitan // 这张表的**内容**就是各语言自己的写法,换成 ASCII 等于把它废了
var builtinLabels = map[string]string{
	"zh": "中文", "zh-hans": "简体", "zh-hant": "繁體",
	"ja": "日本語", "ko": "한국어", "ru": "Русский",
	"ar": "العربية", "he": "עברית", "th": "ไทย", "el": "Ελληνικά",
}
