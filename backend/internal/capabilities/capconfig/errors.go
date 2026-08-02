package capconfig

import "errors"

// ErrUnknownField —— 写了一个声明里没有的配置键。调用方的错,不是这台机器的错。
var ErrUnknownField = errors.New("capconfig: field is not declared by this capability")

// ErrInvalidValue —— 值不符合声明(类型不对、超出范围、格式不对)。调用方的错。
var ErrInvalidValue = errors.New("capconfig: value does not match the declared field")

// ErrNoScope —— 想写配置却没说挂在谁身上(空 owner / 空 code)。读可以返空,写不行。
var ErrNoScope = errors.New("capconfig: no scope to write the configuration to")

// ErrFieldTaken —— 两个能力在邀请码上占了同一个字段名。写下去的归谁、读回来的是谁的,
// 没有对的答案 —— 启动就该炸,而不是等 owner 发现设置没生效。
var ErrFieldTaken = errors.New("capconfig: two capabilities claim the same code field")
