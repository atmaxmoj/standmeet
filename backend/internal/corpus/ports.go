// ports.go —— corpus 模块对外暴露的读取端口（consumer 面向这些窄接口编程，
// prod 的 *WikiRepo/*OutputRepo/*WritingRepo 结构上满足；eval 内存 fixture 补齐）。
// 从 usecases/visitor_data_sources.go 抽出，让 corpus usecase 与 visitor 编排共享。

package corpus

import "context"

// WikiLister —— owner-scoped wiki corpus for retrieval。内存窗口 ListByOwner
// + DB 懒加载三件套:全量搜(Search)、按 id 读 meta
// (GetMetaByID,上溯算 path)、按 id 读正文(GetByID)。prod *WikiRepo
// 原样满足;eval-harness 内存 fixture 需补这三个。
type WikiLister interface {
	ListByOwner(ctx context.Context, ownerID string, limit int32) ([]Wiki, error)
	Search(
		ctx context.Context, ownerID, query string, limit, offset int32,
	) ([]WikiMeta, error)
	ListChildren(
		ctx context.Context, ownerID string, parentID *string, limit, offset int32,
	) ([]WikiMeta, error)
	GetMetaByID(ctx context.Context, ownerID, id string) (WikiMeta, error)
	GetByID(ctx context.Context, ownerID, id string) (Wiki, error)
}

// OutputLister —— owner-scoped output corpus for retrieval。wiki 的孪生:内存窗口的
// ListByOwner 之外,加 DB 懒加载:全量搜(Search)、按 id 读 meta(GetMetaByID,上溯算
// path)、按 id 读正文(GetByID)。prod *OutputRepo 原样满足。
type OutputLister interface {
	ListByOwner(ctx context.Context, ownerID string, limit int32) ([]Output, error)
	Search(
		ctx context.Context, ownerID, query string, limit, offset int32,
	) ([]OutputMeta, error)
	ListChildren(
		ctx context.Context, ownerID string, parentID *string, limit, offset int32,
	) ([]OutputMeta, error)
	GetMetaByID(ctx context.Context, ownerID, id string) (OutputMeta, error)
	GetByID(ctx context.Context, ownerID, id string) (Output, error)
}

// WritingLister —— owner-scoped published writings for retrieval。wiki/output 的
// 第三个孪生:DB 全量搜(Search)+ 按树派生 path 读(GetPublishedByPath),不走内存窗口。
// (writing 按 published 准入 + 自带 path 列,无需 tree 上溯。)corpus_list 仍用
// ListPublishedByOwner 的内存列表(扁平 genre,同 output)。
type WritingLister interface {
	ListPublishedByOwner(ctx context.Context, ownerID string) ([]Writing, error)
	Search(
		ctx context.Context, ownerID, query string, limit, offset int32,
	) ([]Writing, error)
	GetPublishedByPath(ctx context.Context, ownerID, path string) (Writing, error)
}
