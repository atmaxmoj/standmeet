// corpus_ref_resolve.go —— 一条 corpus URI 引用(`genre://path`)指不指得到一条真笔记。
//
// 谁需要它:ghost-steering 的 waypoint 冻结(F-A-26)。owner 在 role 上给 waypoint 写
// evidence_refs;refs 指向空,会造出一个**永久不可访**的引导目的地 —— WaypointLedger 标 visited
// 的办法是拿「本轮真被引用的笔记」按 (genre, 树路径) 拼出 URI 再比对 refs,没有笔记就永远拼不出
// 那条 URI,于是 ghost 每轮重新推它、永远静默不下来。
//
// **判据必须跟 ledger 是同一个**,所以这里复用 pgCorpusLister 的 per-genre finder,并把
// 「解析得出」定义成:存在一条笔记,它的 genre 和树路径**正好**拼成这条 ref。
//
// 不能拿 Get 顶替:Get 是跨 genre 按 path 找第一个命中,wiki 底下有 standpoint 就会让
// subjectivity://standpoint 算作解析得出,而 ledger 永远不认 —— 那就是换个地方重新长出同一个洞。

package usecase

import (
	"context"

	"github.com/atmaxmoj/standmeet/internal/corpus/entity"
)

// RefResolver —— 见文件头。具体类型而非接口(避 ireturn);消费方按自己的窄口子收。
type RefResolver struct {
	lister *pgCorpusLister
}

// NewRefResolver —— prod:跟 corpus host ops 同一份 IndexDeps、同一套 finder。
func NewRefResolver(deps *IndexDeps) *RefResolver {
	return &RefResolver{lister: newPGLister(deps)}
}

// ResolvesRef —— 这条 ref 指得到一条真笔记吗。语法不合法 / genre 不认识 / 没有这条笔记 →
// false。**不判 ACL** —— 「这个 role 能不能看」是另一件事,由授权那道闸(FilterWaypointsByCorpus)
// 管;本函数只回答存在性,两件事分开才各自说得清自己在说什么。
func (r *RefResolver) ResolvesRef(ctx context.Context, ownerID, uri string) bool {
	ref, err := entity.ParseURI(uri)
	if err != nil {
		return false
	}
	for _, find := range r.lister.finders() {
		entry, found := find(ctx, ownerID, ref.Path)
		if found && entry.Genre == string(ref.Genre) {
			return true
		}
	}
	return false
}
