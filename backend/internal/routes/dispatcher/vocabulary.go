// vocabulary.go —— 声明一个操作要用的词汇,收口只是**再导出**它。
//
// 词汇本身住在 internal/infra/facadeparity:域要能说清自己会做什么,而域不该 import 路由。
// 词汇放在收口里的时候,后果是一连串的 —— 域说不出口,声明只好挪到唯一能同时看见两边的
// 地方(组装根),于是每个资源都要在收口重新声明一遍域已有的入参出参,再写一段搬运。
//
// 面这一层只 import 收口,所以这些别名让面不必知道词汇的真实住处。

package dispatcher

import fp "github.com/atmaxmoj/standmeet/internal/infra/facadeparity"

// 一个操作的形状 + 它做的事。
type (
	// Op —— 一个操作,整份声明(id / 说明 / 入参 schema / kind / reach / 实现)。
	Op = fp.Op
	// Invoke —— 操作真正做的事。入参出参是不透明 JSON:协议无关。
	Invoke = fp.Invoke
)

// 错误类别 —— 协议无关的几类,面各自翻成自己的形态(HTTP 状态码 / MCP isError)。
var (
	BadInput  = fp.BadInput
	NotFound  = fp.NotFound
	Conflict  = fp.Conflict
	Unauthed  = fp.Unauthed
	Forbidden = fp.Forbidden
	Upstream  = fp.Upstream

	IsBadInput  = fp.IsBadInput
	IsNotFound  = fp.IsNotFound
	IsConflict  = fp.IsConflict
	IsUnauthed  = fp.IsUnauthed
	IsForbidden = fp.IsForbidden
	IsUpstream  = fp.IsUpstream

	// Coded / CodeOf —— 给面一个机器可读的 code(前端按它分流),消息仍是给人看的那句。
	Coded  = fp.Coded
	CodeOf = fp.CodeOf
)

// opErr / emptyArgsSchema —— 中立词汇的两个小件。还没搬进域的那些资源在用,搬完就消失。
var (
	opErr           = fp.OpErr
	emptyArgsSchema = fp.NoArgs
)
