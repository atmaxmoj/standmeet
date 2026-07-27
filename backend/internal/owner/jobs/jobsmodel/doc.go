// Package jobsmodel —— outbound job-loop 领域值对象:fetched job(1d TTL ephemeral)、job source、
// application(持久快照)、resume content/draft。从 internal/domain god-package 切出,jobs 插件
// (fetch/cache/dedup/usecase/mcp/admin)+ 核心 repo 共享这一份类型。CommittedApplication 内嵌
// access.Code(commit 同步 issue 的邀请码),故本 leaf 依赖 domain。
package jobsmodel
