// scope.go —— 一份配置挂在谁身上。
//
// 这个包原来只会一件事:per-**owner** 的配置。于是能力想要一个 per-**code** 的设置项
// (booker 的"这张码最多能约几次")时没有路可走,只能在组装根手写:一个自己的 collection、
// 一套自己的读写、一段把它接进发码入参的适配 —— 三个文件、两百多行,全是同一份机制的手抄本。
//
// 挂在谁身上是**参数**,不是两套代码。两个 scope 的值分开存(collection 不同),所以一个
// 能力的 owner 配置和 code 配置永远不会互相盖掉。

package capconfig

// Scope —— 配置挂载点:哪一类主体(owner / code)的哪一个。
type Scope struct {
	// key —— 文档里标识主体的字段名("owner_id" / "code_id")。
	key string
	// collection —— 这一类 scope 的值存哪个 collection。分开存,两类值互不覆盖。
	collection string
	// id —— 具体是哪个 owner / 哪张码。
	id string
}

const (
	ownerCollection = "capconfig"
	codeCollection  = "capconfig_code"
	roleCollection  = "capconfig_role"
)

// OwnerScope —— 某个 owner 对这个能力的配置(面板上填的那些)。
func OwnerScope(ownerID string) Scope {
	return Scope{key: "owner_id", collection: ownerCollection, id: ownerID}
}

// CodeScope —— 某一张邀请码上这个能力占的那几个字段(发码时一起填)。
func CodeScope(codeID string) Scope {
	return Scope{key: "code_id", collection: codeCollection, id: codeID}
}

// RoleScope —— 某一个 role 上这个能力占的那几个字段(建 role 时一起填)。
//
// 第三个挂载点,加它只多了这一个构造函数 —— 上面那句"挂在谁身上是参数"到这里才算兑现:
// 前两个 scope 是同时长出来的,第三个才证明这个形状真的能加。
//
// 它跟前两个有一处不同:role 上的配置会随 session **冻结**(见 RoleSnapshot 的
// capability_config)。capconfig 本身是活存储,冻结那一步在发码/开会话时读一次、拍下来,
// 访客整场会话按他进来时的配置走 —— owner 中途改 role,不影响已经在聊的人。
func RoleScope(roleID string) Scope {
	return Scope{key: "role_id", collection: roleCollection, id: roleID}
}

// ok —— 有主体才谈得上配置。空 id(无 code 的会话)→ 读到空,不是错。
func (s Scope) ok() bool { return s.id != "" }
