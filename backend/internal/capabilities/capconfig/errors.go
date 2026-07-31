package capconfig

import "errors"

// ErrUnknownField —— 写了一个声明里没有的配置键。调用方的错,不是这台机器的错。
var ErrUnknownField = errors.New("capconfig: field is not declared by this capability")
