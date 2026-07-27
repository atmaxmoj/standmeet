// Package access —— 访客准入域的对外 facade。薄薄一层,只把内部子包的类型/构造/用例抬上来,
// 一眼看全协议;别的层只 import 这个 facade 包、只用这里的符号。实现是同域兄弟子包
// internal/access/{entity,repo,usecase,db},由 check-domain-facade-boundary 挡住外部直接引用。
//
// # 对外协议
//
// 实体 / 值对象(实现:entity)——
//   - Code(邀请码 = invitation) · CodeMember(一码多人) · CreateAccessCodeInput
//   - Request(无码请求) · CreateAccessRequestInput · APIKey(BYOAI key) + Create/UpdateAPIKeyInput
//   - Role + RoleSnapshot(ACL 快照) · CorpusScope(article-read 授权) · DockButtonConfig · Waypoint
//   - AllowsCorpusScope / MergeWaypoints / ValidateWaypoints / ValidateDockButtons 等纯函数
//   - Public* 内建 role 常量 · Err*(域错误 sentinel)
//
// 仓储(实现:repo)——
//   - RoleRepo / CodeRepo / APIKeyRepo / CapabilityRepo / CodeDenialRepo / RequestRepo + 各 New*
//   - CreateCodeInput / CreateRoleInput / UpdateRoleInput / UpsertBuiltinInput(写入入参)
//
// 用例 / 编排(实现:usecase)——
//   - role: Create/Update/Delete/Get/ListRoles + SetRoleDockButtons(over RolesDeps)
//   - request: SubmitForOwner / ListForOwner / UpdateAccessRequestStatus(over RequestsDeps)
//   - api key: IssueAPIKey / ResolveAPIKey(over 窄 store 端口)
//   - visitor session: NewVisitorSessionStore / VisitorSessionStore / VisitorSessionData
//   - RefValidator / SoleOwnerLookup 等 role 写入时的窄 consumer 端口
//
// 新增能力:实现落对应子包,协议在此加一行转发。
package access
