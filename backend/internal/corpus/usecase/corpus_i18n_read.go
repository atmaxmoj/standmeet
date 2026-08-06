// corpus_i18n_read.go —— 读一条语料时,多语那一层。
//
// **一次给一种语言。** 把两种语言都塞进 agent 的上下文里,等于每条笔记付两遍 token,而且
// 那两份还互相矛盾地讲同一件事;把它们拆成两条命中,则同一条笔记会在检索结果里出现两次。
// 所以这里跟读者页走同一个函数:选一面,中性散文照留。
//
// 有哪些语言**也要报出去** —— 不然 agent 没法"自己决定"(它连有几种都不知道)。

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/i18n"
)

// langReader —— 一条笔记的身份语言 + 切换器标签(pgCorpusLister 经 vault-sync 仓储实现)。
// best-effort:读不到就当没写,按第一面渲染。
type langReader interface {
	NoteLang(ctx context.Context, ownerID, noteID string) (string, map[string]string)
}

// NoteLang —— 实现 langReader。
func (l *pgCorpusLister) NoteLang(
	ctx context.Context, ownerID, noteID string,
) (string, map[string]string) {
	if l.queryRepo == nil {
		return "", map[string]string{}
	}
	got := l.queryRepo.GetLang(ctx, ownerID, noteID)
	return got.Lang, got.Labels
}

// I18nView —— 一条正文的多语视图:选中的那一面 + 有哪些语言可选。
type I18nView struct {
	Body      string
	Lang      string
	Languages []string
}

// ViewFor —— 按 want 选一面。不是多语笔记 → 原样返回,Languages 空(读者页据此不出切换器)。
func ViewFor(body, want, identity string) I18nView {
	doc := i18n.Parse(body)
	if !doc.Multilingual() {
		return I18nView{Body: body, Languages: []string{}}
	}
	return I18nView{
		Body:      i18n.Render(&doc, want, identity),
		Lang:      i18n.Resolve(&doc, want, identity),
		Languages: doc.Langs,
	}
}
