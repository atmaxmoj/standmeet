// Package conversation —— visitor 对话领域值对象:Chat(会话)、Dialog(一问一答)、Message、
// ChatReport(总结)、Citation(答案里挂的 corpus 引用)。从 internal/domain god-package 切出;
// usecases/postgres/routes/ownercore 共享。Citation.Genre = corpusdomain.DocumentGenre(corpus 的 genre
// 枚举,复用同一类型),故本 leaf 依赖 domain。
package conversation
