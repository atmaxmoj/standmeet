// import_unchanged.go —— 「这条 writing 这次有变化吗」。
//
// corp 树那一侧一直有这个判断（`unchangedNode`），writings 这一侧从来没有：找到既有行就
// 无条件 SaveWriting。于是同一份 vault 连导两次，第二次的回执是 `0 new · 1 updated`，
// 而 check 4 的判据是「第二次导入是空操作，内容被保留而不是被重写」。代价不只是数字难看：
// 每导一次全部 writing 的 `updated_at` 就往前跳一次，「最近改过什么」从此说不准（F-L-64）。
//
// 判据写成**一份指纹**而不是一串 `&&`：那样「vault 拥有哪些字段」只有一处清单，加字段的人
// 改的是结构体，不是一个越来越长的布尔表达式。
//
// 保守的一侧是**存**：只要这一批带了附件或封面引用，就照旧走保存 —— 那两样要重新挂，
// 光比标量字段判不出来。

package obsidian

import corpus "github.com/atmaxmoj/standmeet/internal/corpus/facade"

// writingFingerprint —— vault 说了算的那些字段。两份相等 = 这次导入不会改变任何东西。
type writingFingerprint struct {
	title      string
	body       string
	excerpt    string
	slug       string
	headline   string
	hue        string
	visibility string
	published  bool
}

// unchangedWriting —— 既有行跟这次要写进去的东西一字不差（且没有附件要挂）。
func unchangedWriting(w *corpus.Writing, in *corpus.SaveWritingInput) bool {
	if len(in.Files) > 0 || in.CoverImageRef != "" {
		return false
	}
	return fingerprintOfWriting(w) == fingerprintOfInput(in) &&
		sameStrings(w.Tags(), in.Tags)
}

func fingerprintOfWriting(w *corpus.Writing) writingFingerprint {
	return writingFingerprint{
		title: w.Title(), body: w.Body(), excerpt: w.Excerpt(), slug: w.Slug(),
		headline: w.CoverHeadline(), hue: w.CoverHue(), visibility: w.VisibilityMode(),
		published: w.IsPublished(),
	}
}

func fingerprintOfInput(in *corpus.SaveWritingInput) writingFingerprint {
	return writingFingerprint{
		title: in.Title, body: in.BodyMD, excerpt: in.Excerpt, slug: in.Slug,
		headline: in.CoverHeadline, hue: in.CoverHue, visibility: in.Visibility,
		published: in.Publish,
	}
}
