package apierr

// DisplayError —— 一个「message 可直接回显给终端用户」的错误。业务 / usecase 层 return 它，HTTP infra
// （Classify → writeError）认领并原样渲成 envelope；没实现它的错一律走 500 fallback，不外泄内部细节。
// 即「这条错能不能给用户看」由错误自身携带，不再靠每个 handler 维护 sentinel→envelope 的 Case 表。
//
// 结构化满足：任意包的错误只要有这三个方法即是 DisplayError，无需 import apierr（避免依赖倒挂）。
// 包装也认：fmt.Errorf("...: %w", de) 后 errors.As 仍能取出底下的 DisplayError。
type DisplayError interface {
	error
	HTTPStatus() int
	DisplayCode() string
	DisplayMessage() string
}

// displayError —— DisplayError 的标准实现。cause 非 nil 时 Error()（进日志）带底层原因，但
// DisplayMessage()（发客户端）只给人话——「log 原始、发友好」的分离由类型自己保证。字段序按 fieldalignment。
type displayError struct {
	cause   error
	code    string
	message string
	status  int
}

func (e *displayError) Error() string {
	if e.cause != nil {
		return e.message + ": " + e.cause.Error()
	}
	return e.message
}
func (e *displayError) Unwrap() error          { return e.cause }
func (e *displayError) HTTPStatus() int        { return e.status }
func (e *displayError) DisplayCode() string    { return e.code }
func (e *displayError) DisplayMessage() string { return e.message }

// Display —— 造一个可回显错误：HTTP status + 机器码（前端分支用）+ 给用户看的 message（人话，无栈/术语）。
func Display(status int, code, message string) error {
	return &displayError{status: status, code: code, message: message}
}

// DisplayWrap —— 同 Display，但裹一层底层 cause：cause 进日志（Error/Unwrap 可取），客户端仍只见 message。
// 深层函数（如 provider 网络错）用它：一处 return 就同时满足「ops 看得到原始、用户只看人话」。
func DisplayWrap(status int, code, message string, cause error) error {
	return &displayError{status: status, code: code, message: message, cause: cause}
}
