// error_code.go —— 给已分类的错误附一个**稳定的机器可读 code**。
//
// 类别决定状态码(见 errors.go),code 是另一回事:它是调用方按具体情况分流用的字符串,
// 属于已经发出去的契约。两者不是一件事 ——
//
//	Conflict            → 409,默认 code "conflict"
//	Coded(Conflict, …)  → 409,code "role_name_taken"
//
// 为什么要分开:迁移时我把 role 的 role_name_taken / role_builtin_immutable 塌成了
// 类别默认的 conflict / forbidden,状态码没变,但**载荷说的话变少了** —— 前端拿到的从
// "重名了"退化成"冲突了"。类别是给面选状态码的,code 是给调用方分流的,谁也替代不了谁。
//
// 默认 code 够用时不必写:只有"这个 code 是已经发出去的契约"才需要显式钉住。

package facadeparity

import "errors"

// codedError —— 包在类别错误外面的一层,只加一个 code。
// 实现 Unwrap,所以 IsBadInput / IsNotFound / … 照常认得出里面的类别。
type codedError struct {
	inner error
	code  string
}

func (e codedError) Error() string { return e.inner.Error() }
func (e codedError) Unwrap() error { return e.inner }

// Coded —— 给一个已分类的错误钉上机器可读 code。
func Coded(err error, code string) error { return codedError{inner: err, code: code} }

// CodeOf —— 取出显式钉过的 code。没钉过 → ok=false,面用类别的默认 code。
func CodeOf(err error) (string, bool) {
	var t codedError
	if errors.As(err, &t) {
		return t.code, true
	}
	return "", false
}
