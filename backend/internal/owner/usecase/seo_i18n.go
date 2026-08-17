// seo_i18n.go —— landing 上的多语那一层:读者要哪一种语言,以及这条笔记有哪些语言。
//
// 单拎一个文件,因为它跟隔壁"定位一条 landing + 装配它的素材/链接"是两件事:那边回答
// "哪一条",这边回答"哪一面"。

package usecase

import (
	"context"

	corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"
)

// landingNote —— 要渲染的那一条(谁的、哪条、正文、标题)。打包成一个入参守 argument-limit。
// 标题在这儿是因为**正文开头再说一遍标题的那行不渲染**:页头已经印了它(UX-85)。
type landingNote struct {
	ownerID string
	id      string
	body    string
	title   string
}

// landingRender —— 一条 landing 渲染出来的正文 + 它的多语元信息。
type landingRender struct {
	body string
	meta LandingI18n
}

// landingI18n —— 按访客要的语言选一面。多语区块**之外**的散文照留:一条笔记不是 N 份文档,
// 那些句子不属于任何一种语言。要的语言没有 → 退回这条笔记的身份语言(lang),不是第一面。
func landingI18n(
	ctx context.Context, deps SEODeps, note *landingNote, want string,
) landingRender {
	identity, labels := "", map[string]string{}
	if deps.Vault != nil {
		got := deps.Vault.GetLang(ctx, note.ownerID, note.id)
		identity, labels = got.Lang, got.Labels
	}
	body := note.body
	view := corpus.I18nViewFor(body, want, identity, note.title)
	return landingRender{body: view.Body, meta: LandingI18n{
		Lang: view.Lang, Languages: view.Languages, Labels: labels,
	}}
}
