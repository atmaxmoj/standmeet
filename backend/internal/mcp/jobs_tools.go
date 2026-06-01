// jobs_tools.go —— Phase E-10 已迁。6 个 tool 走 cap_jobs.go。
// jobs_views.go 仍保留 (applications + resume 还在用 fetchedJobView)。
//
// errUnauthorized 是 applications_tools.go + resume_tools.go (legacy 路径)
// 还在引用的常量；E-11 + E-12 这俩 file 迁完后一并删。

package mcp

const errUnauthorized = "unauthorized"
