// Package corpus —— 语料域的对外 facade。薄薄一层,把内部子包的类型/构造/用例抬上来,
// 一眼看全协议;别的层只 import 这个 facade 包。实现是同域兄弟子包
// internal/corpus/{entity,repo,usecase,db,search},由 check-domain-facade-boundary 挡住外部直引。
//
// # 对外协议
//
// 实体 / 值对象(实现:entity)——
//   - Raw / Wiki / Writing / Output / Asset / Content / Cover(各 genre 的 aggregate + Init 入参)
//   - Document(URI dispatch 的异构元素) · Visibility / URIRef / TreeNode / Timestamps / SEOSettings
//   - Genre* 常量 · Visibility*/CoverHue* 枚举 · Err*(域错误 sentinel)· ParseURI / FormatURI
//
// 仓储(实现:repo)——
//   - 各 genre 的 Repo(Wiki/Output/Writing/Raw/Asset/Note …)+ 树 / 引用 / vault-sync / seo 查询
//   - TreeChild[T]、Note 及其 Create/Update 入参等持久层类型
//
// 用例 / 编排(实现:usecase)——
//   - CorpusLister + 读取端口(WikiLister/OutputLister/WritingLister,repo 结构上满足)
//   - corpus map / tree / crosslink / index(Meili)/ writings CRUD / assets / note nav 等应用流
//   - sentiment / subjectivity(#135 待外置的能力残留,暂留 usecase)
//
// 新增能力:实现落对应子包,协议在此加一行转发。
package corpus
