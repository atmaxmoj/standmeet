// errors.go —— 收口把错误分成**协议无关的几类**,再具体的形态是各个面自己的事。
//
// 只有三类,而且刻意只有三类:
//
//	BadInput  调用方给错了      → HTTP 400 / MCP isError
//	NotFound  要的东西不存在    → HTTP 404 / MCP isError
//	其余      这台机器出错了    → HTTP 500(细节进日志,不外泄)/ MCP isError
//
// 收口不认识状态码,也不认识 isError。它只说清"是谁的错、是不是找不到",翻译留给面。
//
// 为什么需要它:admin 面把校验从 handler 搬进收口之后,handler 仍然要回 400/404 而不是一律
// 500。如果没有这个区分,两边就得各留一份错误分类 —— 那正是收口要消灭的重复。
//
// 为什么不再多分:每加一类,每个面都要跟着加一条翻译。真正跨面稳定的语义就这么几个;
// 更细的差别(比如"邮件连接器没配好")是**消息内容**,不是新的类别。

package dispatcher

import "errors"

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
