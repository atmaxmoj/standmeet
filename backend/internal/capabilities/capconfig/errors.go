package capconfig

import "errors"

// ErrUnknownField —— 写了一个声明里没有的配置键。调用方的错,不是这台机器的错。
var ErrUnknownField = errors.New("capconfig: field is not declared by this capability")

// ErrInvalidValue —— 值不符合声明(类型不对、超出范围、格式不对)。调用方的错。
var ErrInvalidValue = errors.New("capconfig: value does not match the declared field")
