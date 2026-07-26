// Package corpusdomain —— corpus 领域值对象:Content/Document(统一抽象)、四个 genre 实体
// (Raw/Wiki/Output/Writing)、Cover/TreeNode/Asset/URIRef/Visibility + DocumentGenre 枚举。
// 从 internal/domain god-package 切出;usecases/postgres/routes/ownercore/agentcore 共享。
// 实体内嵌 domain 的共享 VO(Timestamps/Integration),故依赖 domain。
package corpusdomain
