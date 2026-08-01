// errors.go —— 收口把错误分成**协议无关的几类**,再具体的形态是各个面自己的事。
//
// 类别表:
//
//	BadInput  调用方给错了        → HTTP 400 / MCP isError
//	Unauthed  这个身份不再有效    → HTTP 401 / MCP isError(前端据此跳登录)
//	NotFound  要的东西不存在      → HTTP 404 / MCP isError
//	Forbidden 这个东西不许被这么动  → HTTP 403 / MCP isError
//	Conflict  跟已有状态冲突      → HTTP 409 / MCP isError
//	Upstream  依赖的外部服务失败  → HTTP 502 / MCP isError(消息可以直接给人看)
//	其余      这台机器出错了      → HTTP 500(细节进日志,不外泄)/ MCP isError
//
// 收口不认识状态码,也不认识 isError。它只说清是哪一类,翻译留给面。
//
// 为什么需要它:admin 面把校验从 handler 搬进收口之后,handler 仍然要回 400/404/409 而不是
// 一律 500。没有这个区分,两边就得各留一份错误分类 —— 那正是收口要消灭的重复。
//
// **加一类的标准是"有没有面因此行为不同",不是"话说得一样不一样"。** 409 是真类别:前端拿
// status 分流(401 跳登录 / 409 就地处理 / 其余 toast),塌成 400 会改掉它的行为。502 也是:
// 它带的是能直接给人看的话("抓不到这个 skill,检查来源"),塌成 500 会变成"internal error"。
// 反过来,"邮件连接器没配好"跟"缺必填字段"对每个面的行为完全相同 —— 那是**消息内容**,
// 不该变成新类别。每加一类,每个面都要跟着加一条翻译。

package dispatcher

import (
	"errors"
	"fmt"
)

// badInputError —— 调用方给的入参不对(缺必填、格式错、id 不存在这类)。
type badInputError struct{ msg string }

func (e badInputError) Error() string { return e.msg }

// BadInput —— 造一个"调用方给错了"的错误。消息直接面向调用方,要能读懂。
func BadInput(msg string) error { return badInputError{msg: msg} }

// IsBadInput —— 这个错误是调用方的问题吗?面据此选状态码。
func IsBadInput(err error) bool {
	var t badInputError
	return errors.As(err, &t)
}

// notFoundError —— 要操作的东西不存在(id 对不上、已被删)。
type notFoundError struct{ msg string }

func (e notFoundError) Error() string { return e.msg }

// NotFound —— 造一个"找不到"的错误。消息直接面向调用方。
func NotFound(msg string) error { return notFoundError{msg: msg} }

// IsNotFound —— 面据此回 404 而不是 400/500。
func IsNotFound(err error) bool {
	var t notFoundError
	return errors.As(err, &t)
}

// conflictError —— 跟已经存在的状态冲突(重名、重复安装这类)。
type conflictError struct{ msg string }

func (e conflictError) Error() string { return e.msg }

// Conflict —— 造一个"跟现状冲突"的错误。前端拿 409 就地处理,不走通用 toast。
func Conflict(msg string) error { return conflictError{msg: msg} }

// IsConflict —— 面据此回 409。
func IsConflict(err error) bool {
	var t conflictError
	return errors.As(err, &t)
}

// unauthedError —— 这次请求的身份不再成立(会话指向的 owner 已经不存在这类)。
// 跟 Forbidden 的区别是:Forbidden 说"你是谁我认,但这件事不许做",这个说"你是谁我已经不认了"。
// 前端拿 401 会跳登录,所以它必须跟 403 分开。
type unauthedError struct{ msg string }

func (e unauthedError) Error() string { return e.msg }

// Unauthed —— 造一个"身份不再有效"的错误。
func Unauthed(msg string) error { return unauthedError{msg: msg} }

// IsUnauthed —— 面据此回 401(而不是 403/404)。
func IsUnauthed(err error) bool {
	var t unauthedError
	return errors.As(err, &t)
}

// forbiddenError —— 请求本身没问题、东西也在,但这个操作对它不允许(内置的不许改/不许删)。
// 跟 BadInput 的区别是它不是"你写错了",跟 NotFound 的区别是它确实存在 —— 面回 403。
type forbiddenError struct{ msg string }

func (e forbiddenError) Error() string { return e.msg }

// Forbidden —— 造一个"不许这么动"的错误。
func Forbidden(msg string) error { return forbiddenError{msg: msg} }

// IsForbidden —— 面据此回 403。
func IsForbidden(err error) bool {
	var t forbiddenError
	return errors.As(err, &t)
}

// upstreamError —— 我们依赖的外部服务失败了(抓不到远端 skill、上游超时)。
// 消息是写给人看的,可以原样外露 —— 它说的不是我们的内部实现,而是"外面那边不行"。
type upstreamError struct{ msg string }

func (e upstreamError) Error() string { return e.msg }

// Upstream —— 造一个"外部依赖失败"的错误。
func Upstream(msg string) error { return upstreamError{msg: msg} }

// IsUpstream —— 面据此回 502,并把消息给出去(不像 500 那样藏起来)。
func IsUpstream(err error) bool {
	var t upstreamError
	return errors.As(err, &t)
}

// opErr —— 每个 op 的统一包法:说清楚是哪一步坏的,同时保住 errors.Is
// (适配器把域哨兵翻成上面那些类别,包一层不能把它挡掉)。
func opErr(what string, err error) error {
	return fmt.Errorf("%s: %w", what, err)
}

// requireArgs —— 缺哪个必填字段就报哪个。面这一层只管"给没给";给了之后合不合法
// (格式、枚举、存不存在)是域的事。
func requireArgs(pairs ...[2]string) error {
	for _, p := range pairs {
		if p[1] == "" {
			return BadInput(p[0] + " is required")
		}
	}
	return nil
}
