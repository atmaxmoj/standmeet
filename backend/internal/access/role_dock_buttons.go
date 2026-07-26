// role_dock_buttons.go —— #109/#110 per-role chat dock 按钮的领域配置 + 不变量。
//
// 一个 role 最多两个 dock 按钮（chat 两个按钮位）。每个按钮挂一个能力 + 一段「触发词」——
// 访客点按钮 = 把触发词当自己的消息发出去（快捷方式）。title 解析 + code-deny 过滤在会话装配层，
// domain 只管纯配置不变量：数量 ≤2、触发词非空。

package access

import (
	"errors"
	"slices"
	"strings"
)

// MaxDockButtons —— chat 两个按钮位，故上限 2。
const MaxDockButtons = 2

// DockButtonConfig —— 一个 dock 按钮的 owner 配置：挂哪个能力 + 点击发出的触发词。
// 纯配置载体，带 json tag 让 roleView / snapshot 直接序列化（title 在会话装配层另加）。
type DockButtonConfig struct {
	CapabilityID string `json:"capability_id"`
	Trigger      string `json:"trigger"`
}

// ErrTooManyDockButtons —— 配了超过两个 dock 按钮。
var ErrTooManyDockButtons = errors.New("at most two dock buttons per role")

// ErrDockButtonEmptyTrigger —— dock 按钮没填触发词（点了没意义）。
var ErrDockButtonEmptyTrigger = errors.New("dock button needs a non-empty trigger")

// ErrUnknownDockCapability —— dock 按钮挂了一个 role 没有 / 不存在的能力。
var ErrUnknownDockCapability = errors.New("dock button references an unknown capability")

// ValidateDockButtonCapabilities —— 每个按钮的能力必须在 valid 集里（route 从能力注册表给出
// 该 role 可挂的能力 id 集）。valid 为空视作「无可挂能力」→ 有按钮即拒。
func ValidateDockButtonCapabilities(buttons []DockButtonConfig, valid []string) error {
	for i := range buttons {
		if !slices.Contains(valid, buttons[i].CapabilityID) {
			return ErrUnknownDockCapability
		}
	}
	return nil
}

// ValidateDockButtons —— 纯配置校验：数量 ≤2、每个触发词 trim 后非空。空/nil 合法。
func ValidateDockButtons(buttons []DockButtonConfig) error {
	if len(buttons) > MaxDockButtons {
		return ErrTooManyDockButtons
	}
	for i := range buttons {
		if strings.TrimSpace(buttons[i].Trigger) == "" {
			return ErrDockButtonEmptyTrigger
		}
	}
	return nil
}

// cloneDockButtons —— defensive copy（切片 + 内元素都是值，浅拷贝即够）。
func cloneDockButtons(buttons []DockButtonConfig) []DockButtonConfig {
	return slices.Clone(buttons)
}
