// Package ops —— access 域对外能做的事,由域自己声明。
//
// 一个操作在这里是完整的一份:id、说明、入参 schema、语义类别、暴露意图、实现。
// ops.go 本身只放声明时反复用到的几个小件。
package ops

import (
	"encoding/json"
	"time"
)

// noArgs —— 不收参数的操作。
var noArgs = json.RawMessage(`{"type":"object","properties":{}}`)

// nonNilStrings —— nil 切片序列化成 null,调用方要的是 []。
func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

// formatOptionalTime —— nil 保持 null(调用方据此显示"没有")。
func formatOptionalTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(time.RFC3339)
	return &s
}
