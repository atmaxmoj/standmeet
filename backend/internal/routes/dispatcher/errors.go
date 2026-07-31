// errors.go —— 收口只区分一件事:**这是调用方给错了,还是这台机器出错了**。
//
// 再具体的形态是各个面自己的事:HTTP 面把前者翻成 400、后者翻成 500;MCP 面两者都是 isError
// (协议里没有状态码这回事)。收口不认识状态码,也不认识 isError —— 它只说清是谁的错。
//
// 为什么需要它:admin 面把校验从 handler 搬进收口之后,handler 仍然要回 400 而不是 500。
// 如果没有这个区分,两边就得各留一份校验 —— 那正是收口要消灭的东西。

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
