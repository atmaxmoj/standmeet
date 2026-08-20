// corpus_write_args.go —— 一次写请求的**形状**,以及每个字段「没给」是什么意思。
//
// 这不是把 corpus_write.go 切两半凑行数,它是一个自成一体的问题:`corpus.update` 的 schema
// 只要求 `genre` + `id`,所以**每一个字段都可能缺席**,而缺席对每个字段的含义并不相同 ——
//
//	body / title      缺席 = 整份替换里的空值(下游用非空校验挡住,见 UpdateRaw / hasBlankCorpusField)
//	parent_id         缺席 = 不动;给空串 = 挪到根          (F-L-28)
//	show_as_source    缺席 = 保持可引用                     (契约,不是默认值)
//	flagged_private   缺席 = 不动                           (F-L-57)
//	hero 三项          缺席 = 不动                           (既有调用方一个都不带)
//
// 这张表被踩出来过四次,每次都是同一个形状:**裸值表达不了「没给」**,于是"没提到"被当成
// "设成零值",编译不报、回执报成功、屏幕上什么都不说。四次各修了当时那一个字段
// ([[lesson-not-swept-to-neighbours]])——所以现在它们住在一起,下一个加字段的人先读这段。
//
// ⚠️ **这里的指针是手搓的,而房子里已经有现成的**:`fp.OptionalString` / `OptionalBool` /
// `OptionalInt32`(`internal/infra/facadeparity/optional.go`)干的就是这件事 —— `Set` 记的正是
// "调用方提没提过这个字段"。`seo.update_settings` 用的是它,而且它的 Description 直接写着
// 「Omitted fields keep ...」。corpus 和 roles 这两处各自搓了一份等价物 ——
// 能用但**词汇分叉了**([[vocabulary-must-not-diverge]])。收口到 fp.Optional* 是待办,
// 不是这一刀的范围;先把这句话留在这儿,别再有第三份。

package ops

import (
	"context"
	"encoding/json"

	"github.com/atmaxmoj/standmeet/internal/corpus/usecase"
	fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"
)

// corpusWriteArgs —— 建和改共用的入参。哪些字段对哪个 genre 有意义,由分派决定。
type corpusWriteArgs struct {
	// hero 三项:没给 = 不动,不是"清空"。既有调用方一个 hero 字段都不带,
	// 跟着"整份替换"那条规矩走的话,每次改正文都会把 owner 设好的 hero 抹掉。
	CoverImageAssetID *string `json:"cover_image_asset_id"`
	CoverHeadline     *string `json:"cover_headline"`
	CoverHue          *string `json:"cover_hue"`
	// FlaggedPrivate —— 同一个道理的第四次:它曾经是裸 bool,于是 owner 的 AI 说一句
	// 「把这条正文改一下」(`{genre,id,body}`)就把 owner 标的私密**悄悄取消**了,回执还报成功。
	FlaggedPrivate *bool  `json:"flagged_private"`
	Genre          string `json:"genre"`
	ID             string `json:"id"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	// ParentID —— nil = 请求里没有这个字段 = **不动**;指向 "" = 明确挪到根;指向 id = 挪过去。
	//
	// 它曾经是裸 string,于是「没提到父级」和「挪到根」是同一个值。面板的编辑表单既不显示
	// 也不回传这一格(F-L-28),owner 改一次正文,笔记就被拍到根 —— 而**树是语料的地址**:
	// `uriOf` = `genre://<path>`,role/code 的 ACL glob 就长在这个 path 上。一条笔记换了地址,
	// owner 写的 `wiki://a/b/**` 从此拦不住它,屏幕上什么都不说。
	ParentID     *string  `json:"parent_id"`
	Source       string   `json:"source"`
	ShowAsSource *bool    `json:"show_as_source"`
	Tags         []string `json:"tags"`
	CSSClasses   []string `json:"css_classes"`
}

// showAsSource —— 没给就是 true。
//
// **这是个契约,不是默认值的选择**:一条语料建出来就是可引用的来源;藏起来(meta/persona 那类)
// 是 owner 明确要求的例外。genre 参数化之前这里是 `args.ShowAsSource == nil || *args.ShowAsSource`,
// 参数化时被写成了一个裸 bool —— 于是"没提到这个字段"从"保持可引用"变成了"藏起来",
// 而且编译不报、改口的人也看不见。
func (a *corpusWriteArgs) showAsSource() bool {
	return a.ShowAsSource == nil || *a.ShowAsSource
}

// flaggedPrivate —— **建**的时候没给就是 false(新条目默认不私密)。
// 改的时候不能用它,要用 keptFlaggedPrivate:那边"没给"的意思是**不动**。
func (a *corpusWriteArgs) flaggedPrivate() bool {
	return a.FlaggedPrivate != nil && *a.FlaggedPrivate
}

func decodeCorpusWrite(raw json.RawMessage) (corpusWriteArgs, error) {
	var in corpusWriteArgs
	if err := json.Unmarshal(raw, &in); err != nil {
		return in, fp.BadInput("invalid arguments: " + err.Error())
	}
	return in, requireGenre(in.Genre)
}

// parentOrNil —— **建**的时候:没给 / 给空串都是挂在根上,不是错。
func parentOrNil(id *string) *string {
	if id == nil || *id == "" {
		return nil
	}
	return id
}

// keptParentID —— **改**的时候:请求里没给 parent_id 就沿用它现在的父级(不动),
// 给了空串才是「挪到根」。
//
// 为什么要多读一次:下游 `UpdateWikiInput.ParentID` 的 nil 含义是「挪到根」,那是**建**那条路
// 定下来的,改它会牵动每个调用点。所以「不动」在这一层解析掉 —— 读回当前值再原样传下去。
func keptParentID(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (*string, error) {
	if in.ParentID != nil {
		return parentOrNil(in.ParentID), nil
	}
	cur, err := kept(ctx, deps, ownerID, in)
	if err != nil {
		return nil, err
	}
	return cur.ParentID, nil
}

// keptFlaggedPrivate —— **改**的时候:请求里没给 flagged_private 就沿用它现在的值(不动)。
// 跟 keptParentID 同一个形状,同一个理由 —— 只不过这一格错了要人命:它标的是「这条别拿出去」。
func keptFlaggedPrivate(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (bool, error) {
	if in.FlaggedPrivate != nil {
		return *in.FlaggedPrivate, nil
	}
	cur, err := kept(ctx, deps, ownerID, in)
	if err != nil {
		return false, err
	}
	return cur.FlaggedPrivate, nil
}

// keptTags / keptCSSClasses —— 同一条规矩的另外两格。
//
// **这次一起改,不再一格一格来**:这三个字段是同一个缺陷的三个面(F-L-57),而这份文件顶上
// 那张表已经数到第四次了。切片天然分得开「没给」(nil)和「明确清空」(`[]`),所以不需要指针 ——
// 需要的只是有人去读那个区别。
//
// css_classes 尤其藏得深:owner 面一个读接口都不回传它,而**访客那边在用**
// (`WikiReaderClient` 按它渲染那条笔记)。改一次正文把它清掉,退化只出现在访客的屏幕上。
func keptTags(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) ([]string, error) {
	if in.Tags != nil {
		return in.Tags, nil
	}
	cur, err := kept(ctx, deps, ownerID, in)
	if err != nil {
		return nil, err
	}
	return cur.Tags, nil
}

func keptCSSClasses(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) ([]string, error) {
	if in.CSSClasses != nil {
		return in.CSSClasses, nil
	}
	cur, err := kept(ctx, deps, ownerID, in)
	if err != nil {
		return nil, err
	}
	return cur.CSSClasses, nil
}

// kept —— 读回这条现在的样子。上面几个 kept* 都要它,读一次的成本远小于「悄悄清掉一格」。
func kept(
	ctx context.Context, deps usecase.Deps, ownerID string, in *corpusWriteArgs,
) (corpusItemOut, error) {
	return getByGenre(ctx, deps, ownerID, corpusGetArgs{Genre: in.Genre, ID: in.ID})
}
