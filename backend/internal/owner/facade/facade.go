// Package owner —— owner(实例主人)域的对外 facade。薄薄一层,把内部子包的类型/构造/用例抬上来;
// 别的层只 import 这个 facade 包。实现是同域兄弟子包 internal/owner/{entity,repo,usecase,db}
// (以及 jobs 子域),由 check-domain-facade-boundary 挡住外部直引 guts。
//
// # 对外协议
//
//   - 实体(entity): Owner / InstanceSettings / CustomPage / PageContent / Prompt / Keypair /
//     Err* 域错误 + prompt fragment 加载
//   - 仓储(repo): Repo / InstanceRepo / CustomPageRepo / KeypairRepo / PromptRepo + 写入入参
//   - 用例(usecase): account / login / claim / handle / domains / recovery / mail(+otp) /
//     ai-provider / byoai / prompts / custom-page / page(+pins) / seo / css / wiki-tree 等应用流
package owner
