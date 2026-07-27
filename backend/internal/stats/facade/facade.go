// Package stats —— 观测/统计域(Monitor 面的 activity / growth / inference-usage / jobs 计量)的
// 对外 facade。薄薄一层,把内部子包的类型/构造抬上来;别的层只 import 这个 facade 包。实现是
// 同域兄弟子包 internal/stats/{entity,repo,db},由 check-domain-facade-boundary 挡住外部直引。
//
// # 对外协议
//
//   - 实体(entity): Activity / Growth / InferenceUsage / SystemInfo / job-source registry 等读模型值对象
//   - 仓储(repo): activity / growth / inference-usage 的 PG 查询 repo
package stats
